#!/usr/bin/env python3
import sys,torch
sys.path.insert(0,"scripts")
from responsibility_heads import ResponsibilityHeads,ROOMS,ENTITIES,SLOTS,DECISIONS
m=ResponsibilityHeads(32);o=m(torch.zeros(3,32))
assert set(o)=={"semantic","resolution","judgement"}
assert o["semantic"]["op"].shape[0]==3
assert o["resolution"]["room"].shape==(3,len(ROOMS))
assert o["resolution"]["entity"].shape==(3,len(ENTITIES))
assert o["resolution"]["slot"].shape==(3,len(SLOTS))
assert o["judgement"].shape==(3,len(DECISIONS))
# Heads must be independently addressable: no accidental shared output parameters.
ids=[id(p) for h in [*m.semantic.values(),*m.resolution.values(),m.judgement] for p in h.parameters()]
assert len(ids)==len(set(ids))
print({"responsibility_heads":"PASS","semantic":list(m.semantic),"resolution":list(m.resolution),"decisions":len(DECISIONS)})
