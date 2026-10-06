#!/usr/bin/env python3
"""V3 clean compositional resolver benchmark.

Every split sees every SET entity vocabulary item in training supervision.
Dev/test hold out room×entity combinations, not entity identities.
V1/V2 remain observed and unchanged.
"""
from contextual_state_transition_corpus_v1 import target,row

ROOMS=["客厅","主卧","书房","次卧"]
ENTITIES={"空调":("power","ON"),"灯":("power","ON"),"窗户":("opening",30)}
SPLIT={}
def _state():
 s={}
 for a in ROOMS:
  s[f"{a}::空调::default"]={"power":"OFF","temperature":24}
  s[f"{a}::灯::default"]={"power":"OFF","brightness":50}
  s[f"{a}::窗户::default"]={"power":"ON","opening":50}
 return s
def _case(group,split,areas,entity):
 SPLIT[group]=split;slot,value=ENTITIES[entity];before=_state();refs=[target(a,entity) for a in areas];delta=[]
 for a in areas:
  k=f"{a}::{entity}::default"
  if before[k].get(slot)!=value:delta.append((k,slot,value))
 r=row(group,f"{'和'.join(areas)}的{entity}都设置",{"referent_set":refs},delta,before=before,
       semantic={"op":"PATCH_SLOT","cardinality":"SET","slot":slot,"has_value":True})
 r["gold_resolution"]={"applicable":True,"targets":refs,"slot":slot}
 return r
def build():
 # Train covers all entities and all rooms, but only these pairings.
 spec=[
  ("v3-train-ac","train",["客厅","主卧"],"空调"),
  ("v3-train-light","train",["书房","次卧"],"灯"),
  ("v3-train-window","train",["客厅","次卧"],"窗户"),
  # Same entity vocabulary, novel room×entity combinations.
  ("v3-dev-ac","dev",["书房","次卧"],"空调"),
  ("v3-dev-light","dev",["客厅","主卧"],"灯"),
  ("v3-dev-window","dev",["主卧","书房"],"窗户"),
  ("v3-test-ac","test",["客厅","书房"],"空调"),
  ("v3-test-light","test",["主卧","次卧"],"灯"),
  ("v3-test-window","test",["客厅","书房"],"窗户"),
 ]
 return {"truth":"v3_clean_room_entity_compositional_holdout","examples":[_case(*x) for x in spec]}
def split_group(group):return SPLIT[group]
