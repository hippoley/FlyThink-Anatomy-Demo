#!/usr/bin/env python3
"""Collision-free 64d semantic context vector for FlyWire semantic learning."""
import torch
ROOMS=["客厅","主卧","书房","次卧"]
ENTITIES=["空调","灯","窗户","窗帘"]
SLOTS=["power","temperature","brightness","opening","mode"]
# Layout: focus room 0:5 (4 + NONE), focus entity 5:10,
# referent rooms 10:14, entities 14:18, lifecycle 18:22,
# explicit/add target room 22:27, entity 27:32,
# protected 32, history-presence 33, remaining reserved.
DIM=64
def _idx(v,vocab): return vocab.index(v) if v in vocab else len(vocab)
def features(turn):
 x=torch.zeros(DIM);lc=turn.get("lifecycle") or {};focus=lc.get("focused_target") or {}
 x[_idx(focus.get("area"),ROOMS)]=1;x[5+_idx(focus.get("entity"),ENTITIES)]=1
 for t in lc.get("referent_set",[]): 
  if t.get("area") in ROOMS:x[10+ROOMS.index(t["area"])]=1
  if t.get("entity") in ENTITIES:x[14+ENTITIES.index(t["entity"])]=1
 x[18]=bool(lc.get("pending_ids"));x[19]=bool(lc.get("executed_ids"));x[20]=len(lc.get("pending_ids",[]))>1;x[21]=len(lc.get("executed_ids",[]))>1
 target=lc.get("add_target") or lc.get("explicit_target") or {}
 x[22+_idx(target.get("area"),ROOMS)]=1;x[27+_idx(target.get("entity"),ENTITIES)]=1
 x[32]=bool(lc.get("protected_paths"));x[33]=bool(turn.get("context"))
 return x/x.norm().clamp_min(1)
