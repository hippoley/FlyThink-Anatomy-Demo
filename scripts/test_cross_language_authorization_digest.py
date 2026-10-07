#!/usr/bin/env python3
import json
import math
import subprocess
import sys
from authorized_patch_planner import authorization_digest

accepted=[
    ("integer",1),
    ("float_integral",1.0),
    ("negative_zero",-0.0),
    ("small_exp",1e-7),
    ("unicode","窗户"),
    ("nested",{"b":1.0,"a":[-0.0,1e-7]}),
    ("safe_integer_max",9007199254740991),
]
fixed_expected={
    "integer":"e35f2fbdf5eb83fb6af0c48a4f714ec8d46d66200c79a307fe0e63bd09e0db3a",
    "float_integral":"e35f2fbdf5eb83fb6af0c48a4f714ec8d46d66200c79a307fe0e63bd09e0db3a",
    "negative_zero":"5e16b6192bfe6c1917f8120a0b223de1506dc43694b5b90e2cb2797da58e23e8",
    "small_exp":"3a3f9eb1b59b8b1b9730f495812bf25b58b449f560a032c6719a659aaf35da0b",
    "unicode":"f73d3b69afbe95a09f3ef59ce310c6305fb9dc710597b5ff846e5d27e48d7376",
    "nested":"604124d6a8a17a1d951c1dc582172ebe6781e9b8c896d61ae41f37c7d22050f7",
    "safe_integer_max":"3ca9f68f9df08641789edd4a6b2603a7333ba27689acc079df6fe23260d3829b",
}
rejected=[
    ("large_integral_float",1e21),
    ("unsafe_integer",9007199254740992),
    ("nan",float("nan")),
    ("positive_infinity",float("inf")),
    ("negative_infinity",float("-inf")),
]
js=r"""
const {authorizationDigest}=require("./scripts/atomic_authorized_commit.cjs");
let raw="";
process.stdin.setEncoding("utf8");
process.stdin.on("data",d=>raw+=d);
process.stdin.on("end",()=>{
  try {
    const envelope=JSON.parse(raw);
    const value=envelope.kind==="special"
      ? ({nan:NaN,pos_inf:Infinity,neg_inf:-Infinity})[envelope.value]
      : envelope.value;
    const patch={target:"room::window::1",model_id:"CWDS-CA01",slot:"position",capability:"SET",value};
    process.stdout.write(JSON.stringify({ok:true,digest:authorizationDigest([patch])}));
  } catch (e) {
    process.stdout.write(JSON.stringify({ok:false,error:String(e.message||e)}));
  }
});
"""
def node_result(value):
    if isinstance(value,float) and not math.isfinite(value):
        token="nan" if math.isnan(value) else ("pos_inf" if value>0 else "neg_inf")
        raw=json.dumps({"kind":"special","value":token},separators=(",",":"))
    else:
        raw=json.dumps({"kind":"json","value":value},ensure_ascii=False,separators=(",",":"))
    proc=subprocess.run(["node","-e",js],input=raw,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if proc.returncode!=0:
        raise RuntimeError("node_harness_error:"+proc.stderr)
    return json.loads(proc.stdout)

mismatches=[]
for name,value in accepted:
    patch={"target":"room::window::1","model_id":"CWDS-CA01","slot":"position","capability":"SET","value":value}
    try:
        py={"ok":True,"digest":authorization_digest([patch])}
    except Exception as e:
        py={"ok":False,"error":str(e)}
    js_result=node_result(value)
    expected=fixed_expected[name]
    if (not py["ok"] or not js_result["ok"] or py.get("digest")!=expected or js_result.get("digest")!=expected):
        mismatches.append({"case":name,"expected":"fixed_digest:"+expected,"python":py,"js":js_result})

for name,value in rejected:
    patch={"target":"room::window::1","model_id":"CWDS-CA01","slot":"position","capability":"SET","value":value}
    try:
        authorization_digest([patch]); py={"ok":True}
    except Exception as e:
        py={"ok":False,"error":str(e)}
    js_result=node_result(value)
    if py["ok"] or js_result["ok"]:
        mismatches.append({"case":name,"expected":"reject_both","python":py,"js":js_result})

print(json.dumps({
    "cross_language_digest_contract":"PASS" if not mismatches else "MISMATCH_FOUND",
    "accepted_cases":len(accepted),
    "rejected_cases":len(rejected),
    "mismatches":mismatches,
},ensure_ascii=False))
sys.exit(1 if mismatches else 0)
