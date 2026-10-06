#!/usr/bin/env python3
from contextual_state_transition_corpus_v3 import build,split_group
def pairs(r):
 g=r["gold_resolution"];return {(t["area"],t["entity"]) for t in g["targets"]}
rows=build()["examples"];by={s:[r for r in rows if split_group(r["contrast_group"])==s] for s in ("train","dev","test")}
entities={s:{t["entity"] for r in rs for t in r["gold_resolution"]["targets"]} for s,rs in by.items()}
assert entities["train"]==entities["dev"]==entities["test"]=={"空调","灯","窗户"},entities
train_pairs=set().union(*(pairs(r) for r in by["train"]))
for s in ("dev","test"):
 unseen=set().union(*(pairs(r) for r in by[s]))-train_pairs
 assert unseen, (s,"no compositional holdout")
 for r in by[s]:
  assert any(p not in train_pairs for p in pairs(r)),(s,r["contrast_group"],"row has no unseen pair")
assert all(len(by[s])==3 for s in by),{s:len(v) for s,v in by.items()}
print({"truth":build()["truth"],"rows":{s:len(v) for s,v in by.items()},"entities":{s:sorted(v) for s,v in entities.items()},"train_pairs":sorted(train_pairs)})
