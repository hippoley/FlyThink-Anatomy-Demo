#!/usr/bin/env python3
"""Single checkpoint semantic runtime shared by batch probes and persistent E2E server."""
from semantic_patch_materializer import materialize
from judgement_patch_pipeline import decide_and_compose
from context_slot_resolver import resolve_slot
from lexical_operation_evidence import operation_evidence,safe_block_override


def predict(inference,capability_index,text,context=None,background=None):
 ctx=context or {}
 bg=background if background is not None else ctx
 j=inference.judgement(text,bg)
 ev=operation_evidence(text)
 resolved=bool(ctx.get("focused_target") or ctx.get("add_target") or ctx.get("referent_set"))

 if ev and resolved and j["decision"]=="CLARIFY":
  j={"decision":"EXECUTE","confidence":j["confidence"],"override":{"from":"CLARIFY","evidence":ev}}
 elif j["decision"]=="BLOCK" and safe_block_override(ev,ctx,bg):
  j={"decision":"EXECUTE","confidence":j["confidence"],"override":{"from":"BLOCK","evidence":ev}}

 if j["decision"]!="EXECUTE":
  return {"decision":j["decision"],"patches":[],"confidence":j["confidence"]}

 raw=inference.patch(text,ctx)
 if ev:
  override={k:v for k,v in ev.items() if k in ("op","direction","cardinality")}
  if any(raw.get(k)!=v for k,v in override.items()):
   raw={**raw,**override,"operation_override":ev}

 sem=materialize(raw,text)
 resolver=lambda p,target,c,utterance="":resolve_slot(p,target,c,capability_index,utterance)
 out=decide_and_compose(j,sem,ctx,resolver,text)
 out["semantic_raw"]=raw
 out["confidence"]=j["confidence"]
 return out
