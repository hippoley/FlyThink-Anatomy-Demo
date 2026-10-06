#!/usr/bin/env python3
"""Pre-evaluation leakage and coverage contract for V5."""
from collections import Counter,defaultdict
from contextual_state_transition_corpus_v5 import build
rows=build()["examples"];by={s:[r for r in rows if r["v5_split"]==s] for s in ("train","dev","test")}
assert build()["truth"]=="v5_prefrozen_causal_resolver_20261006"
def sig(r):
 ts=r["gold_resolution"]["targets"];return (ts[0]["entity"],tuple(sorted(t["area"] for t in ts)))
# All entity/room vocab and ONE+SET cardinalities must be present in every split.
for s,rs in by.items():
 assert {r["gold_resolution"]["targets"][0]["entity"] for r in rs}=={"空调","灯","窗户"}
 assert {t["area"] for r in rs for t in r["gold_resolution"]["targets"]}=={"客厅","主卧","书房","次卧"}
 assert {len(r["gold_resolution"]["targets"]) for r in rs}=={1,2}
# Held-out SET compositions cannot occur in train for the same entity.
train_set={sig(r) for r in by["train"] if len(r["gold_resolution"]["targets"])>1}
for s in ("dev","test"):
 for r in by[s]:
  if len(r["gold_resolution"]["targets"])>1:assert sig(r) not in train_set,(s,sig(r))
# No exact text overlap across splits.
texts={s:{r["text"] for r in rs} for s,rs in by.items()}
assert not texts["train"]&texts["dev"];assert not texts["train"]&texts["test"];assert not texts["dev"]&texts["test"]
# Each train entity must have >=4 distinct SET room pairs: kills entity->fixed-room-set shortcut.
sets=defaultdict(set)
for r in by["train"]:
 if len(r["gold_resolution"]["targets"])>1:
  e,p=sig(r);sets[e].add(p)
assert all(len(v)>=4 for v in sets.values()),sets
print({"truth":build()["truth"],"rows":{s:len(rs) for s,rs in by.items()},"train_set_pairs":{k:len(v) for k,v in sets.items()},"cardinality":{s:dict(Counter(len(r["gold_resolution"]["targets"]) for r in rs)) for s,rs in by.items()}})
