#!/usr/bin/env python3
"""Deterministic authorized-target composition from learned resolver factors.

Neural heads predict room/entity sets and cardinality. This module is the runtime
boundary: it composes only those factors, intersects them with the mounted device
registry, and never invents an independent target membership prediction.
"""
from resolver_vocabulary import ROOMS,ENTITIES
def topk_mask(logits,k):
 k=max(0,min(int(k),len(logits)));idx=sorted(range(len(logits)),key=lambda i:float(logits[i]),reverse=True)[:k]
 return [i in idx for i in range(len(logits))]
def compose(room_logits,entity_logits,room_count,entity_count=1,mounted=None):
 rm=topk_mask(room_logits,room_count);em=topk_mask(entity_logits,entity_count)
 candidates=[f"{r}::{e}::default" for i,r in enumerate(ROOMS[:-1]) if rm[i] for j,e in enumerate(ENTITIES[:-1]) if em[j]]
 if mounted is not None:candidates=[x for x in candidates if x in set(mounted)]
 return candidates
