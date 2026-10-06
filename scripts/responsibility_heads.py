#!/usr/bin/env python3
"""Responsibility heads with compositional room×entity SET membership."""
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
        self.semantic=torch.nn.ModuleDict({
            "op":torch.nn.Linear(dim,len(OPS)),
            "cardinality":torch.nn.Linear(dim,len(CARD)),
            "direction":torch.nn.Linear(dim,len(DIR)),
            "has_value":torch.nn.Linear(dim,2),
        })
        self.resolution=torch.nn.ModuleDict({
            "room":torch.nn.Linear(dim,len(ROOMS)),
            "entity":torch.nn.Linear(dim,len(ENTITIES)),
            "slot":torch.nn.Linear(dim,len(SLOTS)),
            "room_membership":torch.nn.Linear(dim,len(ROOMS)-1),
            "entity_membership":torch.nn.Linear(dim,len(ENTITIES)-1),
        })
        self.judgement=torch.nn.Linear(dim,len(DECISIONS))

    @staticmethod
    def compose_membership(room_logits,entity_logits):
        # Additive factorization in logit space: unseen room/entity combinations remain constructible.
        return (room_logits.unsqueeze(2)+entity_logits.unsqueeze(1)).flatten(1)

    def forward(self,z):
        res={k:h(z) for k,h in self.resolution.items()}
        res["membership"]=self.compose_membership(res["room_membership"],res["entity_membership"])
        return {
            "semantic":{k:h(z) for k,h in self.semantic.items()},
            "resolution":res,
            "judgement":self.judgement(z),
        }
