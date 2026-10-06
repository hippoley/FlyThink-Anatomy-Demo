#!/usr/bin/env python3
"""Controlled contextual state-transition corpus. Contrast groups are indivisible split units."""
import copy,json
DEVICES={
 "客厅::空调::default":{"power":"ON","temperature":24},
 "主卧::空调::default":{"power":"OFF","temperature":25},
 "客厅::灯::default":{"power":"ON","brightness":70},
 "主卧::灯::default":{"power":"OFF","brightness":40},
 "客厅::窗户::default":{"power":"ON","opening":50},
}
def target(area,entity):return {"area":area,"entity":entity,"instance":"default"}
def apply(before,delta):
 after=copy.deepcopy(before);write=[]
 for d,s,v in delta:after[d][s]=v;write.append(f"{d}.{s}")
 all_slots={f"{d}.{s}" for d,x in before.items() for s in x}
 return after,write,sorted(all_slots-set(write))
def row(group,text,context,delta,decision="EXECUTE",before=None,semantic=None):
 b=copy.deepcopy(before or DEVICES);a,w,inv=apply(b,delta)
 return {"contrast_group":group,"text":text,"before_state":b,"context":context,"gold_decision":decision,
 "gold_semantic":semantic or {},"gold_delta":delta,"after_state":a,"write_set":w,"invariant_set":inv}
def build():
 x=[]
 for area in ("客厅","主卧"):
  d=f"{area}::空调::default";old=DEVICES[d]["temperature"]
  x.append(row("focus-relative-temperature","再低一点",{"focused_target":target(area,"空调")},[(d,"temperature",old-1)],semantic={"op":"PATCH_RELATIVE","direction":"NEG","slot":"temperature"}))
 x.append(row("referent-capability","把它调到22度",{"referent_set":[target("客厅","灯"),target("客厅","空调")]},[("客厅::空调::default","temperature",22)],semantic={"op":"PATCH_SLOT","slot":"temperature","has_value":True}))
 x.append(row("referent-capability","把它调到22度",{"referent_set":[target("客厅","空调"),target("主卧","空调")]},[],decision="CLARIFY",semantic={"op":"PATCH_SLOT","slot":"temperature","has_value":True}))
 x.append(row("add-vs-replace","卧室的也打开",{"focused_target":target("客厅","空调"),"add_target":target("主卧","空调")},[("主卧::空调::default","power","ON")],semantic={"op":"ADD_DEVICE"}))
 x.append(row("add-vs-replace","不是客厅，是卧室",{"focused_target":target("客厅","空调"),"explicit_target":target("主卧","空调")},[],semantic={"op":"REPLACE_TARGET"}))
 x.append(row("lifecycle-same-text","刚才那个算了",{"pending_ids":["p1"],"executed_ids":[]},[],semantic={"op":"CANCEL_PENDING"}))
 x.append(row("lifecycle-same-text","刚才那个算了",{"pending_ids":[],"executed_ids":["e1"]},[],semantic={"op":"UNDO_EXECUTED"}))
 x.append(row("lifecycle-same-text","刚才那个算了",{"pending_ids":[],"executed_ids":[]},[],decision="CLARIFY"))
 for brightness in (10,90):
  b=copy.deepcopy(DEVICES);b["客厅::灯::default"]["brightness"]=brightness
  x.append(row("irrelevant-light-state","客厅空调调到22度",{"explicit_target":target("客厅","空调")},[("客厅::空调::default","temperature",22)],before=b,semantic={"op":"PATCH_SLOT","slot":"temperature","has_value":True}))
 x.append(row("dev-explicit-slot","主卧空调设成23度",{"explicit_target":target("主卧","空调")},[("主卧::空调::default","temperature",23)],semantic={"op":"PATCH_SLOT","slot":"temperature","has_value":True}))
 x.append(row("dev-ambiguity","把空调打开",{"referent_set":[target("客厅","空调"),target("主卧","空调")]},[],decision="CLARIFY",semantic={"op":"PATCH_SLOT","slot":"power"}))
 x.append(row("train-ambiguity","把灯打开",{"referent_set":[target("客厅","灯"),target("主卧","灯")]},[],decision="CLARIFY",semantic={"op":"PATCH_SLOT","slot":"power"}))
 x.append(row("test-explicit-slot","客厅灯调到55%",{"explicit_target":target("客厅","灯")},[("客厅::灯::default","brightness",55)],semantic={"op":"PATCH_SLOT","slot":"brightness","has_value":True}))
 x.append(row("set-two-ac","两个空调都打开",{"referent_set":[target("客厅","空调"),target("主卧","空调")]},[("主卧::空调::default","power","ON")],semantic={"op":"PATCH_SLOT","cardinality":"SET","slot":"power"}))
 return {"truth":"contextual_state_transition_v1_coverage_complete","examples":x}
FROZEN_SPLIT={
 "focus-relative-temperature":"train","referent-capability":"test","add-vs-replace":"train",
 "lifecycle-same-text":"dev","irrelevant-light-state":"train","set-two-ac":"train",
 "dev-explicit-slot":"dev","dev-ambiguity":"dev","train-ambiguity":"train","test-explicit-slot":"test",
}
def split_group(group):return FROZEN_SPLIT[group]
if __name__=="__main__":
 d=build();groups=sorted({r["contrast_group"] for r in d["examples"]})
 print(json.dumps({"truth":d["truth"],"n":len(d["examples"]),"groups":groups,"splits":{g:split_group(g) for g in groups}},ensure_ascii=False,indent=2))
