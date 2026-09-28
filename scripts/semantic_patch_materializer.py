#!/usr/bin/env python3
"""Turn raw checkpoint predictions into semantic proposal fields only."""
def materialize(raw,text):
 p={"op":raw["op"],"cardinality":raw["cardinality"]}
 if raw["op"]=="PATCH_RELATIVE":
  p["delta"]=-1 if raw["direction"]=="NEG" else 1 if raw["direction"]=="POS" else 0
 # Values remain deterministic extraction/clarification, not invented by classifier.
 if raw.get("has_value"):
  import re
  m=re.search(r"(?<!\d)(\d{1,3})(?:度|%)?",text)
  if m:p["value"]=int(m.group(1))
 return p
