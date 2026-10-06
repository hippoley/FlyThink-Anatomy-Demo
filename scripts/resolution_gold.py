#!/usr/bin/env python3
"""Resolution gold: selected targets are distinct from minimal state writes."""
def target_from_device_key(k):
 a,e,i=k.split("::",2);return {"area":a,"entity":e,"instance":i}
def gold_resolution(row):
 if row.get("gold_decision","EXECUTE")!="EXECUTE":return {"targets":[],"slot":"NONE","applicable":False}
 sem=row.get("gold_semantic",{});ctx=row.get("context",{})
 # SET semantics select the full referent set even when some selected devices already satisfy the command.
 if sem.get("cardinality")=="SET" and ctx.get("referent_set"):
  return {"targets":ctx["referent_set"],"slot":sem.get("slot","NONE"),"applicable":True}
 seen=[];slot="NONE"
 for d,s,_ in row.get("gold_delta",[]):
  t=target_from_device_key(d)
  if t not in seen:seen.append(t)
  if slot=="NONE":slot=s
 return {"targets":seen,"slot":slot,"applicable":bool(seen)}
if __name__=="__main__":
 from contextual_state_transition_corpus_v1 import build
 for r in build()["examples"]:print(r["contrast_group"],gold_resolution(r))
