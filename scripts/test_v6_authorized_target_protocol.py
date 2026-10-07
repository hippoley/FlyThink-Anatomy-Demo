#!/usr/bin/env python3
from authorized_target_composer import compose
from responsibility_heads import ROOMS,ENTITIES
from v6_authorized_target_corpus import build
def logits(vocab,selected):
 return [10.0 if x in selected else -10.0 for x in vocab]
rows=build()["examples"];exact=unauthorized=0
for r in rows:
 pred=compose(logits(ROOMS[:-1],r["rooms"]),logits(ENTITIES[:-1],r["entities"]),r["room_count"],r["entity_count"],r["mounted"])
 exact+=pred==r["gold_authorized"]
 unauthorized+=sum(x not in set(r["mounted"]) for x in pred)
assert exact==len(rows),(exact,len(rows))
assert unauthorized==0,unauthorized
print({"truth":build()["truth"],"examples":len(rows),"authorized_target_exact":exact/len(rows),"unauthorized_targets":unauthorized})
