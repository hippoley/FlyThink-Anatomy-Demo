#!/usr/bin/env python3
"""Build train/dev/test rows for layered experiments without sibling leakage."""
from contextual_state_transition_corpus_v1 import build,split_group
from responsibility_labels import labels
def rows(split):
 out=[]
 for r in build()["examples"]:
  if split_group(r["contrast_group"])==split:out.append({"row":r,"labels":labels(r)})
 return out
def audit():
 d={s:rows(s) for s in ("train","dev","test")}
 return {s:{"rows":len(xs),"groups":sorted({x["row"]["contrast_group"] for x in xs})} for s,xs in d.items()}
if __name__=="__main__":print(audit())
