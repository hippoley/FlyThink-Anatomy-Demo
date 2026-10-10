#!/usr/bin/env python3
"""Resolve patch targets from the current utterance and world context.

Precedence is deliberate:
current-turn corrected explicit target > current-turn explicit target >
semantic proposal target > additive target > set referents > focus >
single referent.
"""
import re

ENTITY_ALIASES={
 "空调":("空调","空调机","冷气机","冷气","空调设备"),
 "灯":("灯","灯光","照明灯","照明","灯具"),
 "窗":("窗","窗户","玻璃窗","窗子","外窗"),
}

def key(t):
 return (t.get("area"),t.get("entity"),t.get("instance","default"))

def uniq(xs):
 out=[];seen=set()
 for x in xs or []:
  k=key(x)
  if k not in seen:
   seen.add(k)
   out.append(dict(x))
 return out

def _registry_targets(context):
 out=[]
 for raw in (context.get("device_registry") or {}):
  parts=str(raw).split("::")
  if len(parts)<2:continue
  out.append({
   "area":parts[0],
   "entity":parts[1],
   "instance":parts[2] if len(parts)>2 and parts[2] else "default",
  })
 return uniq(out)

def explicit_targets_from_text(text,context):
 """High-precision exact area+entity grounding from the bound device registry."""
 t=text or ""
 matches=[]
 for target in _registry_targets(context):
  area=target.get("area") or ""
  entity=target.get("entity") or ""
  aliases=ENTITY_ALIASES.get(entity,(entity,))
  if area and area in t and any(alias and alias in t for alias in aliases):
   matches.append(target)
 return uniq(matches)

def _correction_suffix(text):
 t=text or ""
 for marker in ("改成","而是"):
  if marker in t:return t.rsplit(marker,1)[1]
 m=re.search(r"不是[^，,。；;]*[，,]\s*是(.+)$",t)
 return m.group(1) if m else None

def corrected_explicit_target(text,context):
 """Resolve only the positive side of an explicit correction.

 This deliberately avoids treating the rejected target as a candidate. If the
 correction suffix does not bind exactly one registry target, return None and
 let the normal fail-closed resolution path decide.
 """
 suffix=_correction_suffix(text)
 if not suffix:return None
 xs=explicit_targets_from_text(suffix,context)
 return xs[0] if len(xs)==1 else None

def resolve_targets(text,proposal,context):
 corrected=corrected_explicit_target(text,context)
 if corrected:
  return {"mode":"ONE","targets":[corrected],"source":"explicit_correction_text"}
 text_targets=explicit_targets_from_text(text,context)
 explicit=proposal.get("target")
 explicit_set=proposal.get("targets")
 referents=uniq(context.get("referent_set",[]))
 focus=context.get("focused_target")

 # A target named in the current utterance must beat stale focus/referents.
 if len(text_targets)==1:
  return {"mode":"ONE","targets":text_targets,"source":"explicit_text"}
 if len(text_targets)>1:
  multi=any(x in (text or "") for x in (
   "和","以及","都","同时","、","跟","两处","两个","两台","两盏","两扇"
  ))
  if multi:return {"mode":"SET","targets":text_targets,"source":"explicit_text_set"}
  return {"mode":"CLARIFY","targets":[],"source":"ambiguous_explicit_text"}

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
