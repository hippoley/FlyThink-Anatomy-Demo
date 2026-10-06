#!/usr/bin/env python3
"""Resolution gold derived from the annotated transition, never guessed from focus context."""
def target_from_device_key(k):
 a,e,i=k.split("::",2);return {"area":a,"entity":e,"instance":i}
def gold_resolution(row):
 if row.get("gold_decision","EXECUTE")!="EXECUTE":return {"targets":[],"slot":"NONE","applicable":False}
 seen=[];slot="NONE"
 for d,s,_ in row.get("gold_delta",[]):
  t=target_from_device_key(d)
  if t not in seen:seen.append(t)
  if slot=="NONE":slot=s
 # Zero-device-delta operations (e.g. replacement/lifecycle) require namespace-specific gold later.
 return {"targets":seen,"slot":slot,"applicable":bool(seen)}
if __name__=="__main__":
 from contextual_state_transition_corpus_v1 import build
 for r in build()["examples"]:print(r["contrast_group"],gold_resolution(r))
