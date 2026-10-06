#!/usr/bin/env python3
"""Indexed supervision with explicit responsibility applicability."""
import torch
from responsibility_heads import ROOMS,ENTITIES,SLOTS,DECISIONS
from semantic_patch_contract import OPS,CARD,DIR
from train_flywire_delta import text_features
from semantic_context_features import features as context_features
def semantic_label(raw):
 return {"op":raw.get("op","PATCH_SLOT"),"cardinality":raw.get("cardinality","ONE"),"direction":raw.get("direction","ZERO"),"has_value":bool(raw.get("has_value",False))}
def pack(items):
 xs=[];ys=[]
 for item in items:
  r=item["row"];lab=item["labels"];sem=semantic_label(lab["semantic"]);res=lab["resolution"]
  xs.append(torch.cat([text_features(r["text"]),context_features({"text":r["text"],**r["context"]})]))
  ys.append({"semantic":{"op":OPS.index(sem["op"]),"cardinality":CARD.index(sem["cardinality"]),"direction":DIR.index(sem["direction"]),"has_value":int(sem["has_value"])},
   "resolution":{"room":ROOMS.index(res["room"]),"entity":ENTITIES.index(res["entity"]),"slot":SLOTS.index(res["slot"])},
   "resolution_applicable":bool(res.get("applicable",False)),"resolution_targets":res.get("targets",[]),
   "judgement":DECISIONS.index(lab["judgement"])})
 return torch.stack(xs),ys
def batch_targets(ys,device="cpu"):
 out={"semantic":{},"resolution":{}}
 for k in ("op","cardinality","direction","has_value"):out["semantic"][k]=torch.tensor([y["semantic"][k] for y in ys],device=device)
 for k in ("room","entity","slot"):out["resolution"][k]=torch.tensor([y["resolution"][k] for y in ys],device=device)
 out["judgement"]=torch.tensor([y["judgement"] for y in ys],device=device)
 out["resolution_mask"]=torch.tensor([y["resolution_applicable"] and len(y["resolution_targets"])==1 for y in ys],dtype=torch.bool,device=device)
 return out
