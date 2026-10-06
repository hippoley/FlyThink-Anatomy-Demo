#!/usr/bin/env python3
"""Indexed supervision with compositional ONE/SET resolver targets."""
import torch
from responsibility_heads import ROOMS,ENTITIES,SLOTS,DECISIONS,TARGETS
from semantic_patch_contract import OPS,CARD,DIR
from train_flywire_delta import text_features
from semantic_context_features import features as context_features

def semantic_label(raw):
    return {"op":raw.get("op","PATCH_SLOT"),"cardinality":raw.get("cardinality","ONE"),"direction":raw.get("direction","ZERO"),"has_value":bool(raw.get("has_value",False))}
def target_key(t):return f'{t["area"]}::{t["entity"]}::{t.get("instance","default")}'

def pack(items):
    xs=[];ys=[]
    for item in items:
        r=item["row"];lab=item["labels"];sem=semantic_label(lab["semantic"]);res=lab["resolution"];ts=res.get("targets",[])
        membership=[0.0]*len(TARGETS);room_membership=[0.0]*(len(ROOMS)-1);entity_membership=[0.0]*(len(ENTITIES)-1)
        for t in ts:
            k=target_key(t)
            if k in TARGETS:membership[TARGETS.index(k)]=1.0
            if t["area"] in ROOMS[:-1]:room_membership[ROOMS.index(t["area"])]=1.0
            if t["entity"] in ENTITIES[:-1]:entity_membership[ENTITIES.index(t["entity"])]=1.0
        one=bool(res.get("applicable",False)) and len(ts)==1;sett=bool(res.get("applicable",False)) and len(ts)>1
        xs.append(torch.cat([text_features(r["text"]),context_features({"text":r["text"],**r["context"]})]))
        ys.append({
            "semantic":{"op":OPS.index(sem["op"]),"cardinality":CARD.index(sem["cardinality"]),"direction":DIR.index(sem["direction"]),"has_value":int(sem["has_value"])},
            "resolution":{"room":ROOMS.index(res["room"]),"entity":ENTITIES.index(res["entity"]),"slot":SLOTS.index(res["slot"]),"membership":membership,"room_membership":room_membership,"entity_membership":entity_membership,"room_count":len({t["area"] for t in ts}) if res.get("applicable",False) else 0},
            "resolution_one":one,"resolution_set":sett,"judgement":DECISIONS.index(lab["judgement"])
        })
    return torch.stack(xs),ys

def batch_targets(ys,device="cpu"):
    out={"semantic":{},"resolution":{}}
    for k in ("op","cardinality","direction","has_value"):out["semantic"][k]=torch.tensor([y["semantic"][k] for y in ys],device=device)
    for k in ("room","entity","slot","room_count"):out["resolution"][k]=torch.tensor([y["resolution"][k] for y in ys],device=device)
    for k in ("membership","room_membership","entity_membership"):out["resolution"][k]=torch.tensor([y["resolution"][k] for y in ys],dtype=torch.float32,device=device)
    out["judgement"]=torch.tensor([y["judgement"] for y in ys],device=device)
    out["resolution_one_mask"]=torch.tensor([y["resolution_one"] for y in ys],dtype=torch.bool,device=device)
    out["resolution_applicable_mask"]=torch.tensor([y["resolution_one"] or y["resolution_set"] for y in ys],dtype=torch.bool,device=device)
    out["resolution_set_mask"]=torch.tensor([y["resolution_set"] for y in ys],dtype=torch.bool,device=device)
    return out
