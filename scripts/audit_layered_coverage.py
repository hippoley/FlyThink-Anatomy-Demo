#!/usr/bin/env python3
"""Fail closed when a layered split cannot support a claimed metric."""
from layered_dataset import rows
def coverage(split):
 xs=rows(split);execs=[x for x in xs if x["labels"]["judgement"]=="EXECUTE"]
 return {"rows":len(xs),"execute_rows":len(execs),
  "semantic_supervised":sum(bool(x["labels"]["semantic"]) for x in xs),
  "resolution_supervised":sum(any(v!="NONE" for v in x["labels"]["resolution"].values()) for x in execs),
  "judgement_classes":sorted({x["labels"]["judgement"] for x in xs})}
if __name__=="__main__":
 for s in ("train","dev","test"):print(s,coverage(s))
