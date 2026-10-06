#!/usr/bin/env python3
"""Three-layer accuracy contract with explicit responsibility/applicability masks."""
def _mean(xs):return sum(xs)/len(xs) if xs else None
def semantic_accuracy(rows):
 eligible=[r for r in rows if r.get("semantic_applicable",True)]
 return {"accuracy":_mean([bool(r["semantic_ok"]) for r in eligible]),"n":len(eligible)}
def resolution_accuracy(rows):
 # Resolution is undefined when gold judgement does not permit execution.
 eligible=[r for r in rows if r.get("gold_decision")=="EXECUTE" and r.get("resolution_applicable",True)]
 return {"accuracy":_mean([bool(r["resolution_ok"]) for r in eligible]),"n":len(eligible)}
def judgement_accuracy(rows):
 eligible=[r for r in rows if "judgement_ok" in r]
 return {"accuracy":_mean([bool(r["judgement_ok"]) for r in eligible]),"n":len(eligible)}
def state_transition_accuracy(rows):
 eligible=[r for r in rows if r.get("transition_applicable",True)]
 return {"accuracy":_mean([bool(r["state_exact"]) for r in eligible]),"n":len(eligible),
         "no_drift":_mean([not bool(r.get("untouched_state_violation")) for r in eligible]),
         "wrong_device":sum(int(r.get("wrong_device",0)) for r in eligible)}
def report(rows):
 return {"semantic":semantic_accuracy(rows),"resolution":resolution_accuracy(rows),
         "judgement":judgement_accuracy(rows),"state_transition":state_transition_accuracy(rows)}
