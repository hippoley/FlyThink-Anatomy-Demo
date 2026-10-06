#!/usr/bin/env python3
"""Leakage-safe layered datasets with explicit corpus version."""
from responsibility_labels import labels
def source(version="v1"):
 if version=="v1":
  from contextual_state_transition_corpus_v1 import build,split_group
 elif version=="v2":
  from contextual_state_transition_corpus_v2 import build,split_group
 else:raise ValueError(version)
 return build,split_group
def rows(split,version="v1"):
 build,split_group=source(version);out=[]
 for r in build()["examples"]:
  if split_group(r["contrast_group"])==split:out.append({"row":r,"labels":labels(r)})
 return out
def audit(version="v1"):
 d={s:rows(s,version) for s in ("train","dev","test")}
 return {s:{"rows":len(xs),"groups":sorted({x["row"]["contrast_group"] for x in xs})} for s,xs in d.items()}
if __name__=="__main__":
 print({"v1":audit("v1"),"v2":audit("v2")})
