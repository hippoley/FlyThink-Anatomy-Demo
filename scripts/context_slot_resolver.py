#!/usr/bin/env python3
"""Derive writable semantic slot candidates from immutable 46-model capability index."""
import json
from pathlib import Path
ALIASES={"temperature":("temperature","temp"),"opening":("opening","position","percent"),"power":("power","switch","onoff"),"mode":("mode",)}
def load(path="_site/capability-index.json"):
 d=json.loads(Path(path).read_text());assert d["truth"]=="compiled_from_all_46_fixed_user_uploaded_thing_models";return d
def writable_candidates(index,model_id=None):
 rows=index.get("capabilities",index.get("rows",[]));out=set()
 for r in rows:
  if model_id and r.get("model_id")!=model_id:continue
  if r.get("kind")!="p" or "write" not in r.get("ops",[]):continue
  hay=" ".join(str(r.get(k,"")).lower() for k in ("code","name","identifier"))
  for slot,words in ALIASES.items():
   if any(w in hay for w in words):out.add(slot)
 return sorted(out)
def resolve_slot(proposal,target,context,index):
 if proposal.get("slot"):return {"slot":proposal["slot"],"source":"explicit"}
 registry=context.get("device_registry",{});k=f'{target.get("area")}::{target.get("entity")}::{target.get("instance","default")}';mid=registry.get(k,{}).get("model_id")
 if not mid:return {"slot":None,"source":"clarify_unbound_device","candidates":[]}
 c=writable_candidates(index,mid)
 if len(c)==1:return {"slot":c[0],"source":"capability_unique"}
 return {"slot":None,"source":"clarify","candidates":c}
