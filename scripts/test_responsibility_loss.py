#!/usr/bin/env python3
import sys,torch
sys.path.insert(0,"scripts")
from responsibility_heads import ResponsibilityHeads
from responsibility_loss import joint_loss
m=ResponsibilityHeads(8);o=m(torch.zeros(2,8))
t={"semantic":{"op":torch.tensor([0,1])},"resolution":{"room":torch.tensor([0,1])},"judgement":torch.tensor([0,1])}
full,parts=joint_loss(o,t);assert set(parts)=={"semantic","resolution","judgement"}
sem,_=joint_loss(o,{"semantic":t["semantic"]});assert sem.ndim==0
masked,_=joint_loss(o,t,{"resolution":0.0,"judgement":0.0})
assert torch.allclose(masked,parts["semantic"])
print({"joint_loss":"PASS","independent_ablation":True})
