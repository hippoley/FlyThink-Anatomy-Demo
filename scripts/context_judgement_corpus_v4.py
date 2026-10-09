#!/usr/bin/env python3
"""V4 train-only judgement curriculum for V3 failure families.

V3 dev/final rows remain frozen. New rows use disjoint surface forms and focus
on EXECUTE-vs-lifecycle confusions before semantic patch prediction.
"""
from context_judgement_corpus_v3 import build as base_build,ex

ROOMS=["客厅","主卧","书房","次卧"]
NOISE=["空气质量记录正常","昨晚自动化没有告警","网关心跳正常","传感器电量充足"]

def build():
 d=base_build();train=list(d["train"])
 # Explicit correction is an executable current-turn instruction, not lifecycle
 # cancellation and not a request to replace persistent task identity.
 corrections=[
  ("前面目标说错了；实际处理书房空调，温控设为21度","客厅空调"),
  ("纠正刚才的房间：应当是次卧灯，灯光强度60%","主卧灯"),
  ("之前提到次卧不算，本轮明确改客厅窗的窗体开合度为40%","次卧窗"),
  ("前一处说错了，现在明确处理主卧空调并设为25度","书房空调"),
 ]
 for i,(text,focus) in enumerate(corrections):
  train.append(ex({"focus":focus,"pending":[],"executed":[],"history":NOISE*(1+i%2)},
    text,"EXECUTE","explicit_correction",evidence=["explicit_current_instruction"]))

 # Explicit two-target commands are executable; plurality alone is not CLARIFY.
 multi=[
  "请同步设置客厅和书房的空调，两处温控都设为23度",
  "主卧、次卧这两处灯一起处理：灯光强度分别设为70%",
  "一次改两处：客厅窗与书房窗的窗体开合度都取50%",
  "客厅和主卧两台空调同步设定为24度",
 ]
 for i,text in enumerate(multi):
  train.append(ex({"focus":None,"referent_set":[],"pending":[],"history":NOISE*(1+i%3)},
    text,"EXECUTE","explicit_multi_target",evidence=["explicit_targets"]))

 # Unambiguous direct assignments/stops must not collapse into lifecycle labels.
 direct=[
  "请把客厅空调的温控直接设为22度",
  "我要主卧灯最终灯光强度等于55%",
  "让书房窗停止工作但保留这个设备",
  "让次卧灯停止工作但保留这个设备",
 ]
 for i,text in enumerate(direct):
  train.append(ex({"focus":None,"pending":[],"executed":[],"history":NOISE*(1+i%2)},
    text,"EXECUTE","explicit_direct",evidence=["explicit_target"]))

 # True ambiguity contrast: singular deictic follow-up with multiple referents.
 for text in ["当前这一个再调一些","选中的那个再改一点","其中这个再变化一些"]:
  train.append(ex({"focus":None,"referent_set":["客厅空调","书房空调"],"pending":[],"executed":[],"history":NOISE*2},
    text,"CLARIFY","multi_referent_ambiguity",evidence=["referent_set"],missing=["unique_referent"]))

 # Same semantic direction is executable when there is one focus.
 for text in ["当前设备往低方向调一档","保持这个目标再增加一档","当前对象继续收一档"]:
  train.append(ex({"focus":"客厅空调","referent_set":["客厅空调"],"pending":[],"executed":[],"history":NOISE*2},
    text,"EXECUTE","single_focus_relative",evidence=["focus"]))

 return {
  "truth":"long_context_judgement_v4_v3_failure_curriculum_train_only",
  "train":train,
  "dev":d["dev"],
  "final":d["final"]
 }

if __name__=="__main__":
 import json
 from collections import Counter
 d=build();print(json.dumps({
  "truth":d["truth"],"train":len(d["train"]),"dev":len(d["dev"]),"final":len(d["final"]),
  "families":dict(Counter(x["family"] for x in d["train"]))
 },ensure_ascii=False))
