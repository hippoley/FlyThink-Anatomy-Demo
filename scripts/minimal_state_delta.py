#!/usr/bin/env python3
"""Minimal State Delta oracle: every mutation must be inside the declared write-set."""
import copy
def flatten(x,p=""):
 out={}
 if isinstance(x,dict):
  for k,v in x.items():out.update(flatten(v,f"{p}.{k}" if p else str(k)))
 else:out[p]=x
 return out
def changed(before,after):
 a,b=flatten(before),flatten(after);return {k for k in set(a)|set(b) if a.get(k)!=b.get(k)}
def assert_minimal_delta(before,after,write_set):
 delta=changed(before,after);allowed=set(write_set)
 leaked={p for p in delta if not any(p==w or p.startswith(w+".") for w in allowed)}
 if leaked:raise AssertionError(f"state drift outside write-set: {sorted(leaked)}")
 return {"changed":sorted(delta),"write_set":sorted(allowed),"drift":[]}
