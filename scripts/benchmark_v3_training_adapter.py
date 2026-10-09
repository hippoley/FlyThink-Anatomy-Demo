#!/usr/bin/env python3
"""Adapt Benchmark V3.2 train/dev turns into existing checkpoint training contracts.

Sealed turns are never returned by this module.
"""
import copy,random
import generate_long_trajectory_benchmark_v3 as v3

RELEASE_ID="2026-10-r2"
COUNT=180
SEMANTIC_FAMILIES={
 "direct_slot","direct_power","relative_coreference","explicit_correction","multi_target"
}

def _clone(x): return copy.deepcopy(x)

def benchmark_rows(release_id=RELEASE_ID,count=COUNT):
 profile=v3.semantic_profile(release_id)
 if profile=="legacy_v3_1":
  raise ValueError("training_adapter_requires_corrected_v3_profile")
 rng=random.Random(v3.release_seed(release_id))
 rows=[v3.make(i,count,rng,profile) for i in range(count)]
 assert not any(x["split"]=="sealed" for x in rows if x["split"] not in ("train","dev","sealed"))
 return rows

def context_before(tr,index):
 focus=None;refs=[]
 if index>0:
  prev=tr["turns"][index-1]
  if prev["gold_decision"]=="EXECUTE":
   gt=prev.get("gold_target")
   if isinstance(gt,list):
    refs=_clone(gt)
    if len(gt)==1:focus=_clone(gt[0])
   elif gt:
    focus=_clone(gt);refs=[_clone(gt)]
 ctx={
  "focused_target":focus,
  "referent_set":refs,
  "pending_ids":[],
  "executed_ids":[],
  "failed_execution_ids":[],
  "protected_paths":[],
  "device_keys":sorted(tr["initial_runtime"]["devices"]),
  "device_registry":{
   k:{"model_id":d.get("model_id")}
   for k,d in tr["initial_runtime"]["devices"].items()
   if d.get("model_id")
  }
 }
 ctx.update(_clone(tr["turns"][index].get("context_hint") or {}))
 return ctx

def judgement_row(tr,index):
 t=tr["turns"][index];ctx=context_before(tr,index)
 return {
  "background":ctx,
  "utterance":t["text"],
  "judgement":{
   "decision":t["gold_decision"],
   "reason":"v3_"+t["scenario_family"],
   "evidence":["benchmark_v3_train_dev"],
   "missing":["referent"] if t["gold_decision"]=="CLARIFY" else [],
   "protected":[]
  },
  "family":"v3_"+t["scenario_family"],
  "source":{
   "benchmark_release":RELEASE_ID,
   "split":tr["split"],
   "trajectory":tr["id"],
   "turn_id":t.get("turn_id")
  }
 }

def _round_robin_cap(rows,key_fn,limit):
 groups={}
 for row in rows:groups.setdefault(key_fn(row),[]).append(row)
 for xs in groups.values():xs.sort(key=lambda x:(x["source"]["trajectory"],x["source"]["turn_id"]))
 out=[];keys=sorted(groups);i=0
 while len(out)<limit and any(groups[k] for k in keys):
  k=keys[i%len(keys)];i+=1
  if groups[k]:out.append(groups[k].pop(0))
 return out

def judgement_rows(split,limit_per_decision=240):
 if split not in ("train","dev"):raise ValueError("training_adapter_split_forbidden")
 all_rows=[]
 for tr in benchmark_rows():
  if tr["split"]!=split:continue
  all_rows.extend(judgement_row(tr,i) for i in range(len(tr["turns"])))
 out=[]
 for decision in ("EXECUTE","CLARIFY"):
  xs=[x for x in all_rows if x["judgement"]["decision"]==decision]
  out.extend(_round_robin_cap(xs,lambda x:x["family"],min(limit_per_decision,len(xs))))
 return out

def semantic_row(tr,index):
 t=tr["turns"][index]
 if t["gold_decision"]!="EXECUTE":return None
 if t["scenario_family"] not in SEMANTIC_FAMILIES:return None
 p={"op":t["gold_op"]}
 if isinstance(t.get("gold_target"),list):p["targets"]=_clone(t["gold_target"])
 elif t.get("gold_target"):p["target"]=_clone(t["gold_target"])
 if "gold_slot" in t:p["slot"]=t["gold_slot"]
 if "gold_value" in t:p["value"]=_clone(t["gold_value"])
 if "gold_delta" in t:p["delta"]=t["gold_delta"]
 if "gold_slots" in t:p["slots"]=_clone(t["gold_slots"])
 return {
  "text":t["text"],
  "gold_patches":[p],
  "lifecycle":context_before(tr,index),
  "family":"v3_"+t["scenario_family"],
  "source":{
   "benchmark_release":RELEASE_ID,
   "split":tr["split"],
   "trajectory":tr["id"],
   "turn_id":t.get("turn_id"),
   "surface_naming_class":t.get("surface_naming_class"),
   "instruction_shape":t.get("instruction_shape")
  }
 }

def semantic_rows(split,limit_per_family=140):
 if split not in ("train","dev"):raise ValueError("training_adapter_split_forbidden")
 groups={}
 for tr in benchmark_rows():
  if tr["split"]!=split:continue
  for i in range(len(tr["turns"])):
   row=semantic_row(tr,i)
   if row:groups.setdefault(row["family"],[]).append(row)
 out=[]
 for fam,xs in sorted(groups.items()):
  xs.sort(key=lambda x:(x["source"]["trajectory"],x["source"]["turn_id"]))
  out.extend(xs[:limit_per_family])
 return out

if __name__=="__main__":
 import json
 print(json.dumps({
  "judgement_train":len(judgement_rows("train")),
  "judgement_dev":len(judgement_rows("dev",120)),
  "semantic_train":len(semantic_rows("train")),
  "semantic_dev":len(semantic_rows("dev",60)),
 },ensure_ascii=False))
