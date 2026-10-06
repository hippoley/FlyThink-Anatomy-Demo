#!/usr/bin/env python3
import sys,torch
sys.path.insert(0,"scripts")
from resolution_contrast_loss import contrastive_resolution_loss
z=torch.tensor([[0.,0.],[0.1,0.],[2.,0.]],requires_grad=True)
ys=[
 {"resolution_applicable":True,"resolution_targets":[{"area":"客厅","entity":"空调"}]},
 {"resolution_applicable":True,"resolution_targets":[{"area":"客厅","entity":"空调"}]},
 {"resolution_applicable":True,"resolution_targets":[{"area":"主卧","entity":"空调"}]},
]
l=contrastive_resolution_loss(z,ys);assert l.item()>0;l.backward();assert z.grad is not None
print({"resolver_contrast_loss":"PASS","loss":l.item()})
