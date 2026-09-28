#!/usr/bin/env python3
"""Compose model semantic intent with context-resolved targets and slots."""
from context_target_resolver import resolve_targets
from semantic_patch_materializer import deterministic_value
from semantic_capability_map import relative_delta

def _model_id(context,target):
 registry=context.get("device_registry",{})
 key=f'{target.get("area")}::{target.get("entity")}::{target.get("instance","default")}'
 return registry.get(key,{}).get("model_id")

def compose(proposal,context,slot_resolver=None,text=''):
 r=resolve_targets(text,proposal,context)
 if r["mode"]=="CLARIFY":return {"decision":"CLARIFY","reason":"missing_target","patches":[]}
 p={k:v for k,v in proposal.items() if k not in ("cardinality","target","targets")}
 if r["mode"]=="SET":p["targets"]=r["targets"]
 else:p["target"]=r["targets"][0]
 if slot_resolver and p.get("op") in ("PATCH_SLOT","PATCH_RELATIVE","CLOSE_DEVICE"):
  primary=r["targets"][0]
  s=slot_resolver(p,primary,context,text)
  if not s.get("slot"):return {"decision":"CLARIFY","reason":"ambiguous_slot","patches":[],"candidates":s.get("candidates",[])}
  p["slot"]=s["slot"]
  if p.get("op")=="PATCH_RELATIVE":
   grounded=relative_delta(_model_id(context,primary),p["slot"],p.get("delta",0))
   if grounded is None:return {"decision":"CLARIFY","reason":"unsupported_relative_slot","patches":[]}
   p["delta"]=grounded
  v=deterministic_value(text,p["slot"])
  if v is not None:p["value"]=v
 return {"decision":"EXECUTE","patches":[p],"target_source":r["source"]}
