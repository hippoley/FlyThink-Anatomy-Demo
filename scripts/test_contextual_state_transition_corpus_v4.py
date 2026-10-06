#!/usr/bin/env python3
from collections import defaultdict
from contextual_state_transition_corpus_v4 import build,split_group
rows=build()["examples"];by={s:[r for r in rows if split_group(r["contrast_group"])==s] for s in ("train","dev","test")}
def sig(r):
 ts=r["gold_resolution"]["targets"];return (ts[0]["entity"],tuple(sorted(t["area"] for t in ts)))
train=defaultdict(set)
for r in by["train"]:
 e,rooms=sig(r);train[e].add(rooms)
assert set(train)=={"空调","灯","窗户"}
assert all(len(v)>=2 for v in train.values()),train
seen={(e,rooms) for e,sets in train.items() for rooms in sets}
for s in ("dev","test"):
 assert len(by[s])==3
 assert {sig(r)[0] for r in by[s]}==set(train)
 for r in by[s]:assert sig(r) not in seen,(s,sig(r),"pair leaked from train")
print({"truth":build()["truth"],"train_room_sets":{k:sorted(v) for k,v in train.items()},"rows":{k:len(v) for k,v in by.items()}})
