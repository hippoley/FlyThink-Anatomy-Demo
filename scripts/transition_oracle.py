#!/usr/bin/env python3
"""Score transition predictions with strict minimal-delta/no-drift semantics."""
def changed(before,after):
 out=set()
 for d,b in before.items():
  for s,v in b.items():
   if after.get(d,{}).get(s)!=v:out.add(f"{d}.{s}")
 return out
def score(gold,pred):
 gs=set(gold["write_set"]);ps=changed(gold["before_state"],pred["after_state"])
 inv=set(gold["invariant_set"])
 return {
  "decision_exact":pred.get("decision")==gold["gold_decision"],
  "write_set_exact":ps==gs,
  "state_exact":pred["after_state"]==gold["after_state"],
  "untouched_state_violation":bool(ps & inv),
  "over_write":sorted(ps-gs),
  "missed_write":sorted(gs-ps),
 }
