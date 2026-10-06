#!/usr/bin/env python3
import sys,torch
sys.path.insert(0,"scripts")
from responsibility_heads import ResponsibilityHeads,ROOMS,ENTITIES,TARGETS
h=ResponsibilityHeads(8)
r=torch.full((1,len(ROOMS)-1),-4.0);e=torch.full((1,len(ENTITIES)-1),-4.0)
r[0,ROOMS.index("客厅")]=4;r[0,ROOMS.index("书房")]=4
e[0,ENTITIES.index("窗户")]=4
m=h.compose_membership(r,e)[0]
picked={TARGETS[i] for i,v in enumerate(m) if v>0}
assert picked=={"客厅::窗户::default","书房::窗户::default"},picked
loss=m.sum();loss.backward() if m.requires_grad else None
print({"compositional_membership":"PASS","picked":sorted(picked),"targets":len(TARGETS)})
