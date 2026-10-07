#!/usr/bin/env python3
import json, subprocess, sys
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
js=r'''
const {authorizationDigest}=require("./atomic_authorized_commit.cjs");
const value=JSON.parse(process.argv[1]);
const patch={target:"room::window::1",model_id:"CWDS-CA01",slot:"position",capability:"SET",value};
process.stdout.write(authorizationDigest([patch]));
'''
mismatches=[]
for name,value in cases:
 p={"target":"room::window::1","model_id":"CWDS-CA01","slot":"position","capability":"SET","value":value}
 py=authorization_digest([p])
 raw=json.dumps(value,ensure_ascii=False,separators=(",",":"))
 js_digest=subprocess.check_output(["node","-e",js,raw],text=True).strip()
 if py!=js_digest:mismatches.append({"case":name,"python":py,"js":js_digest,"json":raw})
print(json.dumps({"cross_language_digest_probe":"PASS" if not mismatches else "MISMATCH_FOUND","cases":len(cases),"mismatches":mismatches},ensure_ascii=False))
sys.exit(1 if mismatches else 0)
