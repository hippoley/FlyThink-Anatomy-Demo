#!/usr/bin/env python3
"""Validate frozen long trajectory benchmark structure and oracle continuity."""
import json,sys
p=sys.argv[1] if len(sys.argv)>1 else "benchmarks/long_trajectories_v1.json";d=json.load(open(p))
m=d["manifest"];ts=d["trajectories"];assert m["trajectories"]>=100
assert all(10<=len(x["turns"])<=30 for x in ts)
ops=set()
for tr in ts:
 prev={}
 for t in tr["turns"]:
  assert t["gold_decision"]=="EXECUTE";assert t["gold_op"] in {"ADD_DEVICE","CLOSE_DEVICE","PATCH_SLOT","PATCH_RELATIVE"};ops.add(t["gold_op"])
  assert t["gold_target"]["area"] and t["gold_target"]["entity"]
  assert t["gold_state"]
  for k,v in t["gold_state"].items():
   if k in prev:
    # Oracle must carry both power and temperature rather than silently dropping state.
    assert set(v)=={"power","temperature"}
   prev[k]=v
assert ops=={"ADD_DEVICE","CLOSE_DEVICE","PATCH_SLOT","PATCH_RELATIVE"}
assert m["turns"]>=1000
print(json.dumps({"valid":True,"trajectories":len(ts),"turns":m["turns"],"ops":sorted(ops),"sha256":m["sha256"]}))
