#!/usr/bin/env python3
"""Frozen whole-home incremental-patch supervision.

This suite teaches/evaluates the semantic distinction between adding another
device, patching a slot, replacing a target, closing, removing, cancelling a
pending action, undoing an executed action, protecting an invariant and
operating on an explicit set.

Gold labels are patches, never regenerated whole-home snapshots.
"""
import copy, json
from pathlib import Path

def target(area, entity, instance="default"):
    return {"area": area, "entity": entity, "instance": instance}

LIVING_AC=target("客厅","空调","ac-1")
BEDROOM_AC=target("主卧","空调","ac-1")
LIVING_WINDOW=target("客厅","窗户","window-1")
BEDROOM_LIGHT=target("主卧","灯","light-1")

def patch(op, **kw):
    return {"op":op, **kw}

FAMILIES={
 "additive_also":[
  ("客厅空调打开", [patch("ADD_DEVICE",target=LIVING_AC,slots={"power":"ON"})]),
  ("卧室的也打开", [patch("ADD_DEVICE",target=BEDROOM_AC,slots={"power":"ON"})]),
 ],
 "slot_minimality":[
  ("客厅空调打开，温度24度，制冷模式", [patch("ADD_DEVICE",target=LIVING_AC,slots={"power":"ON","temperature":24,"mode":"COOL"})]),
  ("温度调到22度", [patch("PATCH_SLOT",target=LIVING_AC,slot="temperature",value=22)]),
 ],
 "explicit_replace":[
  ("打开客厅空调", [patch("ADD_DEVICE",target=LIVING_AC,slots={"power":"ON"})]),
  ("不是客厅，是卧室", [patch("REPLACE_TARGET",**{"from":LIVING_AC,"to":BEDROOM_AC,"remove_old":True},slots={"power":"ON"})]),
 ],
 "close_not_remove":[
  ("打开客厅空调", [patch("ADD_DEVICE",target=LIVING_AC,slots={"power":"ON"})]),
  ("把它关掉", [patch("CLOSE_DEVICE",target=LIVING_AC)]),
 ],
 "remove_not_close":[
  ("把客厅空调挂进当前控制", [patch("ADD_DEVICE",target=LIVING_AC,slots={})]),
  ("把这个设备从当前控制里移除", [patch("REMOVE_DEVICE",target=LIVING_AC)]),
 ],
 "cancel_pending":[
  ("等一下再打开卧室空调", [patch("ADD_DEVICE",target=BEDROOM_AC,slots={})]),
  ("刚才那条先取消，别执行", [patch("CANCEL_PENDING",pending_id="pending:bedroom-ac-on")]),
 ],
 "undo_executed":[
  ("客厅空调调到22度", [patch("PATCH_SLOT",target=LIVING_AC,slot="temperature",value=22)]),
  ("撤销刚才已经执行的温度修改", [patch("UNDO_EXECUTED",execution_id="exec:living-ac-temp",compensation=patch("PATCH_SLOT",target=LIVING_AC,slot="temperature",value=24))]),
 ],
 "protect_invariant":[
  ("客厅空调保持不变", [patch("PROTECT",target=LIVING_AC,slot="*",reason":"explicit_keep_unchanged")]),
  ("卧室空调调低一点", [patch("PATCH_SLOT",target=BEDROOM_AC,slot="temperature",value={"relative":"lower"})]),
 ],
 "set_operation":[
  ("打开客厅空调和卧室空调", [
    patch("ADD_DEVICE",target=LIVING_AC,slots={"power":"ON"}),
    patch("ADD_DEVICE",target=BEDROOM_AC,slots={"power":"ON"})]),
  ("两个都调到25度", [
    patch("PATCH_SLOT",target=LIVING_AC,slot="temperature",value=25),
    patch("PATCH_SLOT",target=BEDROOM_AC,slot="temperature",value=25)]),
 ],
 "cross_device_preservation":[
  ("客厅窗户开一半，同时打开卧室灯", [
    patch("ADD_DEVICE",target=LIVING_WINDOW,slots={"opening":50}),
    patch("ADD_DEVICE",target=BEDROOM_LIGHT,slots={"power":"ON"})]),
  ("这个也调低一点", [patch("PATCH_SLOT",target=LIVING_WINDOW,slot="opening",value={"relative":"lower"})]),
 ],
}

def build():
    episodes=[]
    for family, turns in FAMILIES.items():
        history=[]
        rows=[]
        for index,(text,patches) in enumerate(turns,1):
            lifecycle = {
              "pending_ids": ["pending:bedroom-ac-on"] if family=="cancel_pending" and index==2 else [],
              "executed_ids": ["exec:living-ac-temp"] if family=="undo_executed" and index==2 else [],
              "referent_set": [LIVING_AC, BEDROOM_AC] if family=="set_operation" and index==2 else [],
              "focused_target": (
                LIVING_AC if family in {"slot_minimality","explicit_replace","close_not_remove","undo_executed"} and index==2
                else LIVING_WINDOW if family=="cross_device_preservation" and index==2
                else None
              ),
            }
            rows.append({
              "turn":index,
              "text":text,
              "context":copy.deepcopy(history),
              "lifecycle":copy.deepcopy(lifecycle),
              "gold_patches":copy.deepcopy(patches),
              "must_preserve_untouched_state":True,
              "family":family,
            })
            history.append({"text":text,"patches":copy.deepcopy(patches)})
        episodes.append({"id":"whole-home-"+family,"family":family,"turns":rows})
    return {
      "truth":"frozen_whole_home_incremental_patch_acceptance",
      "semantic_unit":"minimal_patch_not_full_state_regeneration",
      "families":len(episodes),
      "turns":sum(len(x["turns"]) for x in episodes),
      "required_operations":["ADD_DEVICE","PATCH_SLOT","CLOSE_DEVICE","REMOVE_DEVICE","REPLACE_TARGET","CANCEL_PENDING","UNDO_EXECUTED","PROTECT"],
      "hard_invariant":"untouched_state_preservation_100_percent",
      "episodes":episodes,
    }

def main():
    import argparse
    p=argparse.ArgumentParser();p.add_argument("--output",type=Path,default=Path("_site/whole-home-patch-acceptance.json"));a=p.parse_args()
    data=build();a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({k:data[k] for k in ("truth","families","turns","hard_invariant")},ensure_ascii=False))

if __name__=="__main__": main()
