#!/usr/bin/env python3
"""V4 causal room-binding benchmark: break entity→room-set shortcut in training."""
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
 r["gold_resolution"]={"applicable":True,"targets":refs,"slot":slot};return r
def build():
 # Every entity is paired with multiple room sets in train; entity alone cannot identify rooms.
 train_pairs=[(["客厅","主卧"],"空调"),(["书房","次卧"],"空调"),
              (["客厅","书房"],"灯"),(["主卧","次卧"],"灯"),
              (["客厅","次卧"],"窗户"),(["主卧","书房"],"窗户")]
 dev=[(["客厅","次卧"],"空调"),(["主卧","书房"],"灯"),(["客厅","主卧"],"窗户")]
 test=[(["主卧","书房"],"空调"),(["客厅","次卧"],"灯"),(["书房","次卧"],"窗户")]
 spec=[]
 for i,(a,e) in enumerate(train_pairs):spec.append((f"v4-train-{i}-{e}","train",a,e))
 for i,(a,e) in enumerate(dev):spec.append((f"v4-dev-{i}-{e}","dev",a,e))
 for i,(a,e) in enumerate(test):spec.append((f"v4-test-{i}-{e}","test",a,e))
 return {"truth":"v4_causal_room_binding_shortcut_broken","examples":[_case(*x) for x in spec]}
def split_group(group):return SPLIT[group]
