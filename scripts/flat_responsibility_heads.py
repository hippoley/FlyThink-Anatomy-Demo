#!/usr/bin/env python3
"""Flat 16-target SET membership baseline sharing all non-SET responsibility heads."""
import torch
from responsibility_heads import ResponsibilityHeads,TARGETS
class FlatResponsibilityHeads(ResponsibilityHeads):
 def __init__(self,dim):
  super().__init__(dim)
  self.flat_membership=torch.nn.Linear(dim,len(TARGETS))
 def forward(self,z):
  out=super().forward(z)
  out["resolution"]["membership"]=self.flat_membership(z)
  return out
