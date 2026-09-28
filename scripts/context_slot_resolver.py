#!/usr/bin/env python3
"""Resolve writable semantic slots from the immutable 46-model capability index."""
import json
from pathlib import Path
ALIASES={"temperature":("temperature","temp","温度"),"brightness":("brightness","bright","dimmer","亮度","调光"),"opening":("opening","position","percent","开度"),"power":("power","switch","onoff","开关"),"mode":("mode","模式")}
def load(path="_site/capability-index.json"):
 d=json.loads(Path(path).read_text());assert d["truth"]=="compiled_from_all_46_fixed_user_uploaded_thing_models";return d
def records(index):
 cols=index["columns"];return [dict(zip(cols,row)) for row in index["rows"]]
def writable_candidates(index,model_id=None):
 out=set()
 for r in records(index):
  if model_id and r.get("model")!=model_id:continue
  ops=r.get("ops") or []
  if isinstance(ops,str):ops=[ops]
  if r.get("kind")!="p" or not any("write" in str(x).lower() for x in ops):continue
  hay=" ".join(str(r.get(k,"")).lower() for k in ("code","title","desc"))
  for slot,words in ALIASES.items():
   if any(w in hay for w in words):out.add(slot)
 return sorted(out)
def cue_slot(text):
 t=(text or "").lower()
 for slot,words in ALIASES.items():
  if any(w in t for w in words):return slot
 if any(w in t for w in ("亮一点","暗一点","再亮","再暗")):return "brightness"
 if any(w in t for w in ("高一点","低一点","度")):return "temperature"
 if any(w in t for w in ("开大","开小","大一点","小一点")):return "opening"
 return None
def resolve_slot(proposal,target,context,index,text=""):
 registry=context.get("device_registry",{});k=f'{target.get("area")}::{target.get("entity")}::{target.get("instance","default")}';mid=registry.get(k,{}).get("model_id")
 c=writable_candidates(index,mid) if mid else [];cue=cue_slot(text)
 if proposal.get("slot"):
  explicit=proposal["slot"]
  if cue and cue in c and explicit!=cue:return {"slot":cue,"source":"lexical_cue_over_invalid_semantic_slot","candidates":c,"replaced":explicit}
  return {"slot":explicit,"source":"explicit","candidates":c}
 if not mid:return {"slot":None,"source":"clarify_unbound_device","candidates":[]}
 if cue and cue in c:return {"slot":cue,"source":"lexical_cue+capability","candidates":c}
 if len(c)==1:return {"slot":c[0],"source":"capability_unique","candidates":c}
 return {"slot":None,"source":"clarify","candidates":c}
