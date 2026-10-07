#!/usr/bin/env python3
import json
import subprocess
import sys
from authorized_patch_planner import authorization_digest

cases=[
    ("integer",1),
    ("float_integral",1.0),
    ("negative_zero",-0.0),
    ("small_exp",1e-7),
    ("large_exp",1e21),
    ("unicode","窗户"),
    ("nested",{"b":1.0,"a":[-0.0,1e-7]}),
    ("safe_integer_max",9007199254740991),
]
js=r"""
const {authorizationDigest}=require("./scripts/atomic_authorized_commit.cjs");
let raw="";
process.stdin.setEncoding("utf8");
process.stdin.on("data",d=>raw+=d);
process.stdin.on("end",()=>{
  const value=JSON.parse(raw);
  const patch={target:"room::window::1",model_id:"CWDS-CA01",slot:"position",capability:"SET",value};
  process.stdout.write(authorizationDigest([patch]));
});
"""
mismatches=[]
for name,value in cases:
    patch={"target":"room::window::1","model_id":"CWDS-CA01","slot":"position","capability":"SET","value":value}
    py_digest=authorization_digest([patch])
    raw=json.dumps(value,ensure_ascii=False,separators=(",",":"))
    proc=subprocess.run(["node","-e",js],input=raw,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if proc.returncode != 0:
        print(json.dumps({"cross_language_digest_probe":"HARNESS_ERROR","case":name,"stderr":proc.stderr},ensure_ascii=False))
        sys.exit(2)
    js_digest=proc.stdout.strip()
    if py_digest!=js_digest:
        mismatches.append({"case":name,"python":py_digest,"js":js_digest,"json":raw})
print(json.dumps({"cross_language_digest_probe":"PASS" if not mismatches else "MISMATCH_FOUND","cases":len(cases),"mismatches":mismatches},ensure_ascii=False))
sys.exit(1 if mismatches else 0)
