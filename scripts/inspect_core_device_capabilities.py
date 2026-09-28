#!/usr/bin/env python3
import json
from pathlib import Path
d=json.loads(Path("_site/capability-index.json").read_text());cols=d["columns"]
rows=[dict(zip(cols,r)) for r in d["rows"]]
for mid in ("AWGD-ZA01","LIGHT_GROUP","CWDS-CA01"):
 print("MODEL",mid)
 for r in rows:
  if r["model"]!=mid or r["kind"]!="p": continue
  ops=r.get("ops") or []
  if isinstance(ops,str): ops=[ops]
  if any("write" in str(x).lower() for x in ops):
   print(json.dumps({k:r.get(k) for k in ("code","title","desc","ops","dataType","enum","min","max","unit")},ensure_ascii=False))
