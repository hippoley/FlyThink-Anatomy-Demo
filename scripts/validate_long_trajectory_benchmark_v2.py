#!/usr/bin/env python3
import json,sys,hashlib
p=sys.argv[1] if len(sys.argv)>1 else "benchmarks/long_trajectories_v2.json";d=json.load(open(p));m=d["manifest"];ts=d["trajectories"]
assert len(ts)>=100 and m["devices_per_home"]>=12 and set(m["device_types"])=={"空调","灯","窗"}
turns=0
for tr in ts:
 assert 10<=len(tr["turns"])<=30; expected_keys=set(tr["initial_runtime"]["devices"]);assert len(expected_keys)==m["devices_per_home"]
 for t in tr["turns"]:
  turns+=1;assert set(t["gold_state"])==expected_keys,"gold_state must cover the entire home"
  assert len(t["gold_write_set"])>=1
  target=f'{t["gold_target"]["area"]}::{t["gold_target"]["entity"]}::{t["gold_target"].get("instance","default")}'
  assert all(target in x for x in t["gold_write_set"]),"write-set escaped target"
assert turns==m["turns"] and turns>=1000
print(json.dumps({"valid":True,"trajectories":len(ts),"turns":turns,"whole_home_oracle":True,"devices_per_home":m["devices_per_home"],"sha256":m["sha256"]},ensure_ascii=False))
