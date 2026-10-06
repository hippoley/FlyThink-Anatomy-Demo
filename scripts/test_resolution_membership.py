#!/usr/bin/env python3
import sys,torch
sys.path.insert(0,"scripts")
from responsibility_heads import ResponsibilityHeads,TARGETS
from responsibility_loss import joint_loss
n=3;h=ResponsibilityHeads(8);o=h(torch.randn(n,8))
t={"semantic":{"op":torch.zeros(n,dtype=torch.long),"cardinality":torch.zeros(n,dtype=torch.long),"direction":torch.zeros(n,dtype=torch.long),"has_value":torch.zeros(n,dtype=torch.long)},
"resolution":{"room":torch.zeros(n,dtype=torch.long),"entity":torch.zeros(n,dtype=torch.long),"slot":torch.zeros(n,dtype=torch.long),"membership":torch.zeros(n,len(TARGETS))},
"judgement":torch.zeros(n,dtype=torch.long)}
t["resolution"]["membership"][1,0]=1;t["resolution"]["membership"][1,4]=1
loss,p=joint_loss(o,t,masks={"resolution_one":torch.tensor([1,0,0],dtype=torch.bool),"resolution_set":torch.tensor([0,1,0],dtype=torch.bool)})
assert torch.isfinite(loss) and p["resolution"].item()>0
loss.backward()
assert h.resolution["membership"].weight.grad is not None
print({"one_set_resolution_loss":"PASS","targets":len(TARGETS)})
