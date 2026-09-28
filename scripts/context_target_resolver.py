#!/usr/bin/env python3
"""Resolve patch targets from the current utterance and world context.

Precedence is deliberate:
current-turn explicit target > semantic proposal target > additive target >
set referents > focus > single referent.
"""

ENTITY_ALIASES={
 "空调":("空调",),
 "灯":("灯","灯光"),
 "窗":("窗","窗户"),
 "窗户":("窗","窗户"),
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

def resolve_targets(text,proposal,context):
 text_targets=explicit_targets_from_text(text,context)
 explicit=proposal.get("target")
 explicit_set=proposal.get("targets")
 referents=uniq(context.get("referent_set",[]))
 focus=context.get("focused_target")

 # A target named in the current utterance must beat stale focus/referents.
 if len(text_targets)==1:
  return {"mode":"ONE","targets":text_targets,"source":"explicit_text"}
 if len(text_targets)>1:
  multi=any(x in (text or "") for x in ("和","以及","都","两个","两台","两盏","两扇"))
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
