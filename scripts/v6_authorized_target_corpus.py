#!/usr/bin/env python3
"""V6 development protocol for authorized-target composition.

This is deliberately a development corpus, not a sealed benchmark. It stresses
factor-to-target composition and registry fail-closed behavior before a future V7 freeze.
"""
from itertools import combinations
ROOMS=("客厅","主卧","书房","次卧");ENTITIES=("空调","灯","窗户")
def build():
 rows=[]
 for rc in (1,2,3):
  for rooms in combinations(ROOMS,rc):
   for ec in (1,2):
    for entities in combinations(ENTITIES,ec):
     gold=[f"{r}::{e}::default" for r in rooms for e in entities]
     # Deterministic missing-device pattern exercises registry intersection.
     mounted=[x for i,x in enumerate(gold) if not (len(gold)>1 and i==len(gold)-1)]
     authorized=[x for x in gold if x in mounted]
     rows.append({"rooms":rooms,"entities":entities,"room_count":rc,"entity_count":ec,"gold_candidates":gold,"mounted":mounted,"gold_authorized":authorized})
 return {"truth":"v6_authorized_target_composition_development","examples":rows}
