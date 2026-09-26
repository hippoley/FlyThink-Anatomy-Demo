#!/usr/bin/env python3
"""V4 semantic corpus: additive, focus, lifecycle, relative and target-set semantics."""
import copy
AC_L={"area":"客厅","entity":"空调","instance":"default"}
AC_B={"area":"主卧","entity":"空调","instance":"default"}
WIN_L={"area":"客厅","entity":"窗户","instance":"default"}

def r(text,op,target=None,slot=None,value=None,delta=None,lifecycle=None,family="",targets=None):
    p={"op":op}
    if target:p["target"]=copy.deepcopy(target)
    if targets:p["targets"]=copy.deepcopy(targets)
    if slot:p["slot"]=slot
    if value is not None:p["value"]=value
    if delta is not None:p["delta"]=delta
    return {"text":text,"gold_patches":[p],"lifecycle":copy.deepcopy(lifecycle or {}),"family":family}

def build():
    tr=[]; se=[]
    # additive: explicit target + existing focus must coexist
    for t in ["卧室的也打开","主卧空调也开一下","再把卧室空调打开","卧室那个一起开"]:
        tr.append(r(t,"ADD_DEVICE",AC_B,"power","ON",lifecycle={"focused_target":AC_L},family="additive"))
    # focus resolution: same utterance, different focus
    for t in ["把它关掉","这个关一下","关掉这个"]:
      for x in [AC_L,AC_B,WIN_L]:tr.append(r(t,"CLOSE_DEVICE",x,"power","OFF",lifecycle={"focused_target":x},family="focus"))
    # lifecycle counterfactuals
    for t in ["刚才那个不要了","上一条取消","那条作废"]:
      tr.append(r(t,"CANCEL_PENDING",lifecycle={"pending_ids":["p1"]},family="cancel"))
      tr.append(r(t,"UNDO_EXECUTED",lifecycle={"executed_ids":["e1"]},family="undo"))
    # relative semantics: delta is semantic class; runtime computes absolute value
    for t,d in [("这个调低一点",-1),("再低一点",-1),("这个提高一点",1),("再高一点",1)]:
      tr.append(r(t,"PATCH_RELATIVE",AC_L,"temperature",delta=d,lifecycle={"focused_target":AC_L},family="relative"))
    # set semantics: one semantic patch, explicit target set
    for t in ["两个都打开","这两个一起打开","客厅和卧室的都打开"]:
      tr.append(r(t,"PATCH_SLOT",slot="power",value="ON",targets=[AC_L,AC_B],lifecycle={"referent_set":[AC_L,AC_B]},family="set"))
    # sealed unseen surfaces + counterfactual focus/lifecycle
    se += [
      r("卧室那个也来一下","ADD_DEVICE",AC_B,"power","ON",lifecycle={"focused_target":AC_L},family="additive"),
      r("关了它","CLOSE_DEVICE",AC_L,"power","OFF",lifecycle={"focused_target":AC_L},family="focus"),
      r("关了它","CLOSE_DEVICE",AC_B,"power","OFF",lifecycle={"focused_target":AC_B},family="focus"),
      r("关了它","CLOSE_DEVICE",WIN_L,"power","OFF",lifecycle={"focused_target":WIN_L},family="focus"),
      r("这条别要了","CANCEL_PENDING",lifecycle={"pending_ids":["p9"]},family="cancel"),
      r("这条别要了","UNDO_EXECUTED",lifecycle={"executed_ids":["e9"]},family="undo"),
      r("这个再降一点","PATCH_RELATIVE",AC_L,"temperature",delta=-1,lifecycle={"focused_target":AC_L},family="relative"),
      r("这个再升一点","PATCH_RELATIVE",AC_L,"temperature",delta=1,lifecycle={"focused_target":AC_L},family="relative"),
      r("这俩都打开","PATCH_SLOT",slot="power",value="ON",targets=[AC_L,AC_B],lifecycle={"referent_set":[AC_L,AC_B]},family="set"),
    ]
    return {"truth":"v4_set_relative_counterfactual","train":tr,"sealed":se,
            "requirements":["minimal_patch","set_cardinality","relative_not_absolute","context_counterfactual","untouched_state_100_percent"]}
if __name__=="__main__":
 import json;d=build();print(json.dumps({"train":len(d["train"]),"sealed":len(d["sealed"]),"truth":d["truth"]},ensure_ascii=False))
