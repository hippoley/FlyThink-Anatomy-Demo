#!/usr/bin/env python3
"""Resolve patch targets from world context before semantic decoding."""
def key(t): return (t.get("area"),t.get("entity"),t.get("instance"))
def uniq(xs):
 out=[];seen=set()
 for x in xs or []:
  k=key(x)
  if k not in seen:seen.add(k);out.append(dict(x))
 return out
def resolve_targets(text,proposal,context):
 explicit=proposal.get("target")
 explicit_set=proposal.get("targets")
 referents=uniq(context.get("referent_set",[]))
 focus=context.get("focused_target")
 if explicit_set:return {"mode":"SET","targets":uniq(explicit_set),"source":"explicit"}
 if explicit:return {"mode":"ONE","targets":[dict(explicit)],"source":"explicit"}
 # ADD_DEVICE is additive: a named/new target candidate must not be replaced by current focus.
 if proposal.get("op")=="ADD_DEVICE" and context.get("add_target"):
  return {"mode":"ONE","targets":[dict(context["add_target"])],"source":"add_target"}
 if proposal.get("cardinality") not in (None,"ONE") and referents:
  return {"mode":"SET","targets":referents,"source":"referent_set"}
 if focus:return {"mode":"ONE","targets":[dict(focus)],"source":"focus"}
 if len(referents)==1:return {"mode":"ONE","targets":referents,"source":"referent"}
 return {"mode":"CLARIFY","targets":[],"source":"missing_referent"}
