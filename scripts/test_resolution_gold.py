#!/usr/bin/env python3
import sys
sys.path.insert(0,"scripts")
from contextual_state_transition_corpus_v1 import build
from resolution_gold import gold_resolution
r=next(x for x in build()["examples"] if x["contrast_group"]=="set-two-ac")
g=gold_resolution(r)
assert len(g["targets"])==2,g
assert len(r["write_set"])==1,r["write_set"]
assert {x["area"] for x in g["targets"]}=={"客厅","主卧"}
print({"set_selected_targets":2,"minimal_writes":1,"contract":"PASS"})
