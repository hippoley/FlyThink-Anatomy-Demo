#!/usr/bin/env python3
"""Gold extraction for each responsibility. Never infer one layer's label from another."""
from responsibility_heads import ROOMS,ENTITIES,SLOTS,DECISIONS
def _target(r):
 c=r.get("context",{})
 t=c.get("explicit_target") or c.get("add_target") or c.get("focused_target")
 return t or {}
def labels(r):
 s=r.get("gold_semantic",{});t=_target(r)
 return {
  "semantic":s,
  "resolution":{"room":t.get("area","NONE"),"entity":t.get("entity","NONE"),"slot":s.get("slot","NONE")},
  "judgement":r.get("gold_decision","EXECUTE"),
 }
def validate(r):
 y=labels(r)
 assert y["resolution"]["room"] in ROOMS
 assert y["resolution"]["entity"] in ENTITIES
 assert y["resolution"]["slot"] in SLOTS
 assert y["judgement"] in DECISIONS
 return y
