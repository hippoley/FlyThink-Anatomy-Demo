#!/usr/bin/env python3
"""Three-layer accuracy contract. Keep responsibility boundaries explicit."""
def semantic_accuracy(rows):
 # rows: semantic_ok bool, optional head_ok dict
 n=len(rows);return {"accuracy":sum(bool(r["semantic_ok"]) for r in rows)/n if n else 0.0,"n":n}

def resolution_accuracy(rows):
 # Only score target/slot resolution when upstream judgement permits execution.
 eligible=[r for r in rows if r.get("gold_decision")=="EXECUTE"]
 return {"accuracy":sum(bool(r["resolution_ok"]) for r in eligible)/len(eligible) if eligible else 0.0,"n":len(eligible)}

def state_transition_accuracy(rows):
 # Strict whole-state equality after applying predicted minimal patch.
 return {"accuracy":sum(bool(r["state_exact"]) for r in rows)/len(rows) if rows else 0.0,
         "no_drift":sum(not bool(r.get("untouched_state_violation")) for r in rows)/len(rows) if rows else 0.0,
         "wrong_device":sum(int(r.get("wrong_device",0)) for r in rows)}

def report(rows):
 return {"semantic":semantic_accuracy(rows),"resolution":resolution_accuracy(rows),"state_transition":state_transition_accuracy(rows)}
