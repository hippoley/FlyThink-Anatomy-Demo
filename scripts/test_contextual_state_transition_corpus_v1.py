#!/usr/bin/env python3
"""Corpus integrity checks: causality, no-drift and group-level split isolation."""
import sys
sys.path.insert(0,"scripts")
from contextual_state_transition_corpus_v1 import build,split_group
d=build();rows=d["examples"];assert rows
groups={}
for r in rows:
 g=r["contrast_group"];groups.setdefault(g,set()).add(split_group(g))
 assert set(r["write_set"]).isdisjoint(r["invariant_set"])
 # Recompute all mutations from before -> after; they must equal write_set exactly.
 changed=set()
 for dev,b in r["before_state"].items():
  for slot,v in b.items():
   if r["after_state"][dev][slot]!=v:changed.add(f"{dev}.{slot}")
 assert changed==set(r["write_set"]),(g,changed,r["write_set"])
 if r["gold_decision"]!="EXECUTE":assert not r["write_set"]
assert all(len(v)==1 for v in groups.values()),groups
# Required intervention groups.
required={"focus-relative-temperature","referent-capability","add-vs-replace","lifecycle-same-text","irrelevant-light-state","set-two-ac"}
assert required<=set(groups)
print({"truth":d["truth"],"examples":len(rows),"groups":len(groups),"group_split_isolation":True,"no_drift_contract":True})
