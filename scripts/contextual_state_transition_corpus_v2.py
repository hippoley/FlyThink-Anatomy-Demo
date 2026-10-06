#!/usr/bin/env python3
"""V2 resolver-causal extension. V1 remains an observed historical benchmark."""
from contextual_state_transition_corpus_v1 import build as build_v1, target, row
def build():
 base=build_v1()["examples"];extra=[]
 # Same surface, context intervention changes ONE target.
 for group,split,text,a,e,slot,val in [
  ("v2-train-focus-ac","train","再低一点","书房","空调","temperature",23),
  ("v2-dev-focus-light","dev","再亮一点","次卧","灯","brightness",60),
  ("v2-test-explicit-window","test","书房窗户开到30%","书房","窗户","opening",30)]:
  before=dict(base[0]["before_state"]);before={k:dict(v) for k,v in before.items()}
  key=f"{a}::{e}::default";before.setdefault(key,{"power":"ON",slot:50});before[key].setdefault(slot,50)
  extra.append(row(group,text,{"focused_target":target(a,e),"explicit_target":target(a,e)},[(key,slot,val)],before=before,semantic={"op":"PATCH_RELATIVE" if "一点" in text else "PATCH_SLOT","slot":slot,"has_value":"一点" not in text}))
 # Independent SET groups in every split. Selected set can exceed minimal writes.
 for group,areas,entity,slot,value in [
  ("v2-train-set-lights",["客厅","主卧"],"灯","power","OFF"),
  ("v2-dev-set-ac",["客厅","主卧"],"空调","power","ON"),
  ("v2-test-set-windows",["客厅","书房"],"窗户","opening",20)]:
  before={k:dict(v) for k,v in base[0]["before_state"].items()};refs=[]
  delta=[]
  for a in areas:
   key=f"{a}::{entity}::default";before.setdefault(key,{"power":"ON",slot:50});refs.append(target(a,entity))
   if before[key].get(slot)!=value:delta.append((key,slot,value))
  extra.append(row(group,f"{'和'.join(areas)}的{entity}都设置",{"referent_set":refs},delta,before=before,semantic={"op":"PATCH_SLOT","cardinality":"SET","slot":slot,"has_value":True}))
 return {"truth":"contextual_state_transition_v2_resolver_causal","examples":base+extra}
V2_SPLIT={"v2-train-focus-ac":"train","v2-dev-focus-light":"dev","v2-test-explicit-window":"test","v2-train-set-lights":"train","v2-dev-set-ac":"dev","v2-test-set-windows":"test"}
