#!/usr/bin/env python3
"""Responsibility-specific heads over the shared recurrent FlyWire representation."""
import torch
from semantic_patch_contract import OPS,CARD,DIR
ROOMS=("客厅","主卧","书房","次卧","NONE")
ENTITIES=("空调","灯","窗户","窗帘","NONE")
DECISIONS=("EXECUTE","CLARIFY","BLOCK","NOOP","CANCEL_PENDING","UNDO_EXECUTED")
SLOTS=("power","temperature","brightness","opening","mode","NONE")
TARGETS=tuple(f"{r}::{e}::default" for r in ROOMS[:-1] for e in ENTITIES[:-1])
class ResponsibilityHeads(torch.nn.Module):
 def __init__(self,dim):
  super().__init__()
  self.semantic=torch.nn.ModuleDict({"op":torch.nn.Linear(dim,len(OPS)),"cardinality":torch.nn.Linear(dim,len(CARD)),"direction":torch.nn.Linear(dim,len(DIR)),"has_value":torch.nn.Linear(dim,2)})
  self.resolution=torch.nn.ModuleDict({"room":torch.nn.Linear(dim,len(ROOMS)),"entity":torch.nn.Linear(dim,len(ENTITIES)),"slot":torch.nn.Linear(dim,len(SLOTS)),"membership":torch.nn.Linear(dim,len(TARGETS))})
  self.judgement=torch.nn.Linear(dim,len(DECISIONS))
 def forward(self,z):
  return {"semantic":{k:h(z) for k,h in self.semantic.items()},"resolution":{k:h(z) for k,h in self.resolution.items()},"judgement":self.judgement(z)}
