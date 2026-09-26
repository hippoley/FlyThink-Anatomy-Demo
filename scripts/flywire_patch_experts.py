#!/usr/bin/env python3
"""Mixture-of-semantic-experts decoder on the FlyWire gated representation."""
import torch
from flywire_gated_patch_net import FlyWireGatedPatchNet
from train_flywire_whole_home_patch_v4 import OPS,ROOMS,ENTITIES,SLOTS,CARDINALITY,DELTA
EXPERT_NAMES=["lifecycle","relative","set","target"]
class FlyWirePatchExperts(torch.nn.Module):
 def __init__(self,g,seed=6783,disconnect=False):
  super().__init__();self.core=FlyWireGatedPatchNet(g,seed=seed,disconnect=disconnect);r=len(self.core.read_idx)
  self.router=torch.nn.Linear(r,len(EXPERT_NAMES))
  width=len(OPS)+len(ROOMS)+len(ENTITIES)+len(SLOTS)+len(CARDINALITY)+len(DELTA)
  self.experts=torch.nn.ModuleDict({n:torch.nn.Linear(r,width) for n in EXPERT_NAMES})
 def representation(self,x):
  c=self.core;b=x.shape[0];n=len(c.text_idx)+len(c.ctx_idx)+len(c.read_idx);drive=torch.zeros((b,n),device=x.device)
  drive[:,c.text_idx]=c.text_encoder(x[:,:512]);drive[:,c.ctx_idx]=c.ctx_encoder(x[:,512:]);h=torch.tanh(drive);w=c.base*2*torch.sigmoid(c.gain)
  for _ in range(8):
   rec=torch.zeros_like(h)
   if not c.disconnect:rec.index_add_(1,c.post,h[:,c.pre]*w)
   h=.35*h+.65*torch.tanh(drive+rec)
  return h[:,c.read_idx]
 def forward(self,x):
  z=self.representation(x);return self.router(z),{n:h(z) for n,h in self.experts.items()}
