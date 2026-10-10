#!/usr/bin/env python3
"""Turn raw checkpoint predictions into semantic proposal fields only."""
import re
def deterministic_value(text,slot=None):
 t=text or ""
 patterns={
  "temperature":r"(?<!\d)(\d{1,2})\s*度",
  "brightness":r"(?:亮度[^\d]{0,6})?(\d{1,3})\s*%",
  "opening":r"(?:开到|开度[^\d]{0,6})(\d{1,3})\s*%",
 }
 pat=patterns.get(slot)
 if pat:
  m=re.search(pat,t)
  if m:return int(m.group(1))
 return None
def materialize(raw,text):
 p={"op":raw["op"],"cardinality":raw["cardinality"]}
 if raw.get("slot") is not None:p["slot"]=raw["slot"]
 if "value" in raw:p["value"]=raw["value"]
 if raw["op"]=="CLOSE_DEVICE":p.update({"slot":"power","value":"OFF"})
 elif raw["op"]=="ADD_DEVICE":p["slots"]={"power":"ON"}
 if raw["op"]=="PATCH_RELATIVE":
  p["delta"]=-1 if raw["direction"]=="NEG" else 1 if raw["direction"]=="POS" else 0
 if raw.get("has_value"):
  # Slot is resolved later; keep an untyped numeric candidate only as evidence.
  m=re.search(r"(?<!\d)(\d{1,4})(?:度|%)?",text)
  if m:p["value"]=int(m.group(1))
 return p
