#!/usr/bin/env python3
"""Summarize paired-seed layered ablations without hiding sample counts."""
import json,sys,statistics
p=json.load(open(sys.argv[1]))
out={"truth":p["truth"],"summary":{}}
for regime,runs in p["regimes"].items():
 out["summary"][regime]={}
 for split in ("train","dev","test"):
  out["summary"][regime][split]={}
  for metric in ("semantic","resolution","judgement"):
   vals=[r[split][metric] for r in runs if r[split][metric] is not None]
   out["summary"][regime][split][metric]={"mean":statistics.mean(vals) if vals else None,
    "min":min(vals) if vals else None,"max":max(vals) if vals else None,"seeds":len(vals)}
  out["summary"][regime][split]["resolution_n_per_seed"]=sorted({r[split]["resolution_n"] for r in runs})
print(json.dumps(out,ensure_ascii=False,indent=2))
