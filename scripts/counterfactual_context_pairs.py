#!/usr/bin/env python3
"""Counterfactual context pairs: identical utterance, changed context, changed semantic truth."""
from whole_home_patch_corpus_v6 import r,AC_L,AC_B
LIGHT_L={"area":"客厅","entity":"灯","instance":"default"}
LIGHT_B={"area":"主卧","entity":"灯","instance":"default"}
def pairs():
 return [
  {"id":"relative-low-focus","a":r("再低一点","PATCH_RELATIVE",AC_L,"temperature",family="cf",delta=-1,lifecycle={"focused_target":AC_L}),"b":r("再低一点","PATCH_RELATIVE",AC_B,"temperature",family="cf",delta=-1,lifecycle={"focused_target":AC_B}),"expected_change":["target"]},
  {"id":"relative-bright-focus","a":r("再亮一点","PATCH_RELATIVE",LIGHT_L,"brightness",family="cf",delta=1,lifecycle={"focused_target":LIGHT_L}),"b":r("再亮一点","PATCH_RELATIVE",LIGHT_B,"brightness",family="cf",delta=1,lifecycle={"focused_target":LIGHT_B}),"expected_change":["target"]},
  {"id":"also-add-target","a":r("这个也打开","ADD_DEVICE",AC_L,"power","ON",family="cf",lifecycle={"focused_target":AC_B,"add_target":AC_L}),"b":r("这个也打开","ADD_DEVICE",AC_B,"power","ON",family="cf",lifecycle={"focused_target":AC_L,"add_target":AC_B}),"expected_change":["target"]},
 ]
if __name__=="__main__":
 import json;print(json.dumps({"truth":"counterfactual_context_pairs_v1","pairs":pairs()},ensure_ascii=False,indent=2))
