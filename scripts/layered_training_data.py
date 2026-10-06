#!/usr/bin/env python3
"""Prepare indexed supervision for layered FlyWire A/B/C experiments."""
import torch
from responsibility_heads import ROOMS,ENTITIES,SLOTS,DECISIONS
from semantic_patch_contract import OPS,CARD,DIR,encode
from train_flywire_delta import text_features
from semantic_context_features import features as context_features
def pack(items):
 xs=[];ys=[]
 for item in items:
  r=item["row"];lab=item["labels"];sem=encode({"text":r["text"],"family":"layered",**lab["semantic"]})
  xs.append(torch.cat([text_features(r["text"]),context_features({"text":r["text"],**r["context"]})]))
  ys.append({"semantic":{"op":OPS.index(sem["op"]),"cardinality":CARD.index(sem["cardinality"]),"direction":DIR.index(sem["direction"]),"has_value":int(sem["has_value"])},
   "resolution":{"room":ROOMS.index(lab["resolution"]["room"]),"entity":ENTITIES.index(lab["resolution"]["entity"]),"slot":SLOTS.index(lab["resolution"]["slot"])},
   "judgement":DECISIONS.index(lab["judgement"])})
 x=torch.stack(xs)
 return x,ys
def batch_targets(ys,device="cpu"):
 out={"semantic":{},"resolution":{}}
 for k in ("op","cardinality","direction","has_value"):out["semantic"][k]=torch.tensor([y["semantic"][k] for y in ys],device=device)
 for k in ("room","entity","slot"):out["resolution"][k]=torch.tensor([y["resolution"][k] for y in ys],device=device)
 out["judgement"]=torch.tensor([y["judgement"] for y in ys],device=device);return out
