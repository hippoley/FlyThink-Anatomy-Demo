#!/usr/bin/env python3
"""Deterministic v2 whole-home Patch corpus.

Train/dev and sealed use disjoint surface forms. Critical pairs reuse identical
or near-identical utterances with different lifecycle/referent context so a
text-only memorizer cannot solve the suite.
"""
import copy, json, argparse, random
from pathlib import Path

AC_L={"area":"客厅","entity":"空调","instance":"default"}
AC_B={"area":"主卧","entity":"空调","instance":"default"}
WIN_L={"area":"客厅","entity":"窗户","instance":"default"}

def row(text,op,target=None,slot=None,value=None,lifecycle=None,family=""):
    p={"op":op}
    if target:p["target"]=copy.deepcopy(target)
    if slot:p["slot"]=slot
    if value is not None:p["value"]=value
    return {"text":text,"gold_patches":[p],"lifecycle":copy.deepcopy(lifecycle or {}),"family":family,
            "must_preserve_untouched_state":True}

def build():
    train=[];sealed=[]
    # Surface-diverse additive vs replacement.
    for t in ["卧室的也打开","主卧那个也开着","卧室空调也给我开一下","主卧的同样打开"]:
        train.append(row(t,"ADD_DEVICE",AC_B,"power","ON",{"focused_target":AC_L},"additive"))
    for t in ["不是客厅，是卧室","别弄客厅了，换卧室","客厅那个改成主卧的","目标换成卧室空调"]:
        train.append(row(t,"REPLACE_TARGET",AC_B,lifecycle={"focused_target":AC_L},family="replace"))
    # Same text, lifecycle decides CANCEL vs UNDO.
    for t in ["刚才那个不要了","把刚才那条取消","上一条作废"]:
        train.append(row(t,"CANCEL_PENDING",lifecycle={"pending_ids":["p1"]},"lifecycle_cancel"))
        train.append(row(t,"UNDO_EXECUTED",lifecycle={"executed_ids":["e1"]},"lifecycle_undo"))
    # Same pronoun, focus decides target.
    for focus in [AC_L,AC_B,WIN_L]:
        train.append(row("把它关掉","CLOSE_DEVICE",focus,"power","OFF",{"focused_target":focus},"focus_close"))
    for temp in [20,22,24,26]:
        train.append(row(f"温度调到{temp}度","PATCH_SLOT",AC_L,"temperature",temp,{"focused_target":AC_L},"slot_patch"))
    # Sealed: unseen phrasings, plus exact-text counterfactual lifecycle pairs.
    sealed += [
      row("卧室那个也来一个","ADD_DEVICE",AC_B,"power","ON",{"focused_target":AC_L},"additive"),
      row("不是这个，改卧室那个","REPLACE_TARGET",AC_B,lifecycle={"focused_target":AC_L},"replace"),
      row("刚才那个别要了","CANCEL_PENDING",lifecycle={"pending_ids":["p9"]},"lifecycle_cancel"),
      row("刚才那个别要了","UNDO_EXECUTED",lifecycle={"executed_ids":["e9"]},"lifecycle_undo"),
      row("这条撤掉","CANCEL_PENDING",lifecycle={"pending_ids":["p10"]},"lifecycle_cancel"),
      row("这条撤掉","UNDO_EXECUTED",lifecycle={"executed_ids":["e10"]},"lifecycle_undo"),
      row("关了它","CLOSE_DEVICE",AC_L,"power","OFF",{"focused_target":AC_L},"focus_close"),
      row("关了它","CLOSE_DEVICE",AC_B,"power","OFF",{"focused_target":AC_B},"focus_close"),
      row("关了它","CLOSE_DEVICE",WIN_L,"power","OFF",{"focused_target":WIN_L},"focus_close"),
      row("调成23度","PATCH_SLOT",AC_L,"temperature",23,{"focused_target":AC_L},"slot_patch"),
    ]
    return {"truth":"whole_home_patch_v2_context_counterfactual","train":train,"sealed":sealed,
            "hard_invariant":"untouched_state_preservation_100_percent",
            "design":["disjoint_surface_forms","same_text_different_lifecycle","same_text_different_focus"]}

def main():
    p=argparse.ArgumentParser();p.add_argument("--output",type=Path,default=Path("artifacts/whole-home-patch-v2.json"));a=p.parse_args()
    d=build();a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"train":len(d["train"]),"sealed":len(d["sealed"]),"truth":d["truth"]},ensure_ascii=False))
if __name__=="__main__":main()
