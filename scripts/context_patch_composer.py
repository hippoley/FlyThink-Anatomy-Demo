#!/usr/bin/env python3
"""Compose model semantic intent with context-resolved targets and slots."""
from context_target_resolver import resolve_targets
def compose(proposal,context,slot_resolver=None,text=''):
 r=resolve_targets("",proposal,context)
 if r["mode"]=="CLARIFY":return {"decision":"CLARIFY","reason":"missing_target","patches":[]}
 p={k:v for k,v in proposal.items() if k not in ("cardinality","target","targets")}
 if r["mode"]=="SET":p["targets"]=r["targets"]
 else:p["target"]=r["targets"][0]
 if slot_resolver and p.get("op") in ("PATCH_SLOT","PATCH_RELATIVE","CLOSE_DEVICE"):
  s=slot_resolver(p,r["targets"][0],context,text)
  if not s.get("slot"):return {"decision":"CLARIFY","reason":"ambiguous_slot","patches":[],"candidates":s.get("candidates",[])}
  p["slot"]=s["slot"]
 return {"decision":"EXECUTE","patches":[p],"target_source":r["source"]}
