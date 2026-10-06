#!/usr/bin/env python3
import sys
sys.path.insert(0,"scripts")
from contextual_state_transition_corpus_v2 import build,V2_SPLIT,split_group
from resolution_gold import gold_resolution
d=build();extra=[r for r in d["examples"] if r["contrast_group"] in V2_SPLIT]
assert len(extra)==6\nfor g,s in V2_SPLIT.items():assert split_group(g)==s
for split in ("train","dev","test"):
 rs=[r for r in extra if V2_SPLIT[r["contrast_group"]]==split]
 assert any(len(gold_resolution(r)["targets"])==1 for r in rs)
 assert any(len(gold_resolution(r)["targets"])>1 for r in rs)
print({"truth":d["truth"],"extra":len(extra),"each_split_has_ONE_and_SET":True})
