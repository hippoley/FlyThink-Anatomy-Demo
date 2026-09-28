#!/usr/bin/env python3
"""Semantic-only patch labels: context owns target/set membership and capability grounding owns slots."""
OPS=["ADD_DEVICE","PATCH_SLOT","PATCH_RELATIVE","CLOSE_DEVICE","REMOVE_DEVICE","REPLACE_TARGET","CANCEL_PENDING","UNDO_EXECUTED","PROTECT"]
CARD=["ONE","SET"]
DIR=["NEG","ZERO","POS"]
def encode(turn):
 p=turn["gold_patches"][0];d=p.get("delta",0)
 return {"op":p["op"],"cardinality":"SET" if p.get("targets") else "ONE","direction":"NEG" if d<0 else "POS" if d>0 else "ZERO","has_value":"value" in p or bool(p.get("slots"))}
def exact(a,b):return all(a.get(k)==b.get(k) for k in ("op","cardinality","direction","has_value"))
