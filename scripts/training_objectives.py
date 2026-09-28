#!/usr/bin/env python3
"""Explicit objective definitions for controlled training-regime experiments."""
from collections import defaultdict
from semantic_patch_contract import encode

def semantic_contrast_pairs(rows):
 """Same surface, semantic gold differs: semantic head must separate."""
 groups=defaultdict(list)
 for i,r in enumerate(rows):groups[r["text"]].append((i,encode(r)))
 out=[]
 for xs in groups.values():
  for a in range(len(xs)):
   for b in range(a+1,len(xs)):
    if xs[a][1]!=xs[b][1]:out.append((xs[a],xs[b]))
 return out

def semantic_invariance_pairs(rows):
 """Same semantic gold but context differs: semantic head should stay invariant."""
 groups=defaultdict(list)
 for i,r in enumerate(rows):
  y=encode(r);key=(r["text"],tuple(sorted(y.items())))
  groups[key].append(i)
 return [(xs[a],xs[b]) for xs in groups.values() for a in range(len(xs)) for b in range(a+1,len(xs))]

def resolution_contrast_groups(transition_rows):
 """Groups whose target/write-set changes under a controlled context intervention."""
 groups=defaultdict(list)
 for r in transition_rows:groups[r["contrast_group"]].append(r)
 out={}
 for g,xs in groups.items():
  signatures={tuple(sorted(x["write_set"])) for x in xs}
  if len(signatures)>1:out[g]=xs
 return out
