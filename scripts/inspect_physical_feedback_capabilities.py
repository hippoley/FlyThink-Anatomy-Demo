#!/usr/bin/env python3
"""Print physical feedback candidates for the real CWDS-CA01 window model."""
import json
from pathlib import Path

index=json.loads(Path("_site/capability-index.json").read_text(encoding="utf-8"))
cols=index["columns"]
rows=[dict(zip(cols,row)) for row in index["rows"]]

for r in rows:
    if r.get("model")!="CWDS-CA01" or r.get("kind")!="p":
        continue
    text=" ".join(str(r.get(k,"")).lower() for k in ("code","title","desc"))
    if any(token in text for token in ("motor","position","window","电机","位置","开度","窗")):
        print(json.dumps({
            k:r.get(k) for k in (
                "model","module","code","title","desc","ops",
                "dataType","enum","min","max","unit"
            )
        },ensure_ascii=False))
