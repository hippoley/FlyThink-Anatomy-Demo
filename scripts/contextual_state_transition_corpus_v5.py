#!/usr/bin/env python3
"""V5 pre-frozen causal whole-home resolver corpus.

Design is fixed before first model evaluation:
- 4 rooms x 3 entity types
- ONE and SET requests
- multiple paraphrase surfaces
- every entity and room appears in every split
- held-out entity+room-set compositions in dev/test
- explicit gold_resolution separated from minimal writes
"""
from contextual_state_transition_corpus_v1 import target,row
ROOMS=("客厅","主卧","书房","次卧")
ENTITIES={"空调":("power","ON"),"灯":("power","ON"),"窗户":("opening",30)}
PAIRSETS=(("客厅","主卧"),("客厅","书房"),("客厅","次卧"),("主卧","书房"),("主卧","次卧"),("书房","次卧"))
TEMPLATES=(
 "{rooms}的{entity}都设置",
 "把{rooms}这几个地方的{entity}一起设置",
 "{rooms}的{entity}同时处理",
)
# Latin-style split: each entity sees multiple train pairs; dev/test pairings are held out per entity.
DEV={"空调":PAIRSETS[2],"灯":PAIRSETS[3],"窗户":PAIRSETS[0]}
TEST={"空调":PAIRSETS[3],"灯":PAIRSETS[2],"窗户":PAIRSETS[4]}
def _state():
 s={}
 for a in ROOMS:
  s[f"{a}::空调::default"]={"power":"OFF","temperature":24}
  s[f"{a}::灯::default"]={"power":"OFF","brightness":50}
  s[f"{a}::窗户::default"]={"power":"ON","opening":50}
 return s
def _make(group,split,areas,entity,template):
 slot,value=ENTITIES[entity];before=_state();refs=[target(a,entity) for a in areas];delta=[]
 for a in areas:
  k=f"{a}::{entity}::default"
  if before[k].get(slot)!=value:delta.append((k,slot,value))
 text=template.format(rooms="和".join(areas),entity=entity)
 r=row(group,text,{"referent_set":refs},delta,before=before,semantic={"op":"PATCH_SLOT","cardinality":"SET" if len(areas)>1 else "ONE","slot":slot,"has_value":True})
 r["gold_resolution"]={"applicable":True,"targets":refs,"slot":slot};r["v5_split"]=split;return r
def build():
 out=[];n=0
 for entity in ENTITIES:
  held={DEV[entity],TEST[entity]}
  train=[p for p in PAIRSETS if p not in held]
  for p in train:
   for ti,t in enumerate(TEMPLATES):
    out.append(_make(f"v5-train-{n}-{ti}-{entity}","train",p,entity,t));n+=1
  for split,p in (("dev",DEV[entity]),("test",TEST[entity])):
   for ti,t in enumerate(TEMPLATES):
    out.append(_make(f"v5-{split}-{entity}-{ti}",split,p,entity,t))
 # ONE controls ensure cardinality is not a constant SET shortcut.
 for split in ("train","dev","test"):
  for ei,entity in enumerate(ENTITIES):
   for ri,room in enumerate(ROOMS):
    t=TEMPLATES[(ei+ri)%len(TEMPLATES)]
    out.append(_make(f"v5-{split}-one-{entity}-{room}",split,(room,),entity,t))
 return {"truth":"v5_prefrozen_causal_resolver_20261006","examples":out}
def split_group(group):
 return next(r["v5_split"] for r in build()["examples"] if r["contrast_group"]==group)
