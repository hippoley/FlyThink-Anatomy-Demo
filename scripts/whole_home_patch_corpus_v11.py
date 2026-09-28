#!/usr/bin/env python3
"""V11 train-only contextual matched pairs. Frozen V10 dev/sealed remain untouched."""
from whole_home_patch_corpus_v10 import build as base_build
from whole_home_patch_corpus_v6 import r,AC_L,AC_B,WIN_L
LIGHT_L={"area":"客厅","entity":"灯","instance":"default"}
LIGHT_B={"area":"主卧","entity":"灯","instance":"default"}
def build():
 d=base_build();tr=list(d["train"])
 # Absolute numeric matched pairs: same structural intent, device/slot changes.
 for target,slot,pairs in [
  (AC_L,"temperature",[("把数值调成22度",22),("设定为25度",25),("目标改成19度",19)]),
  (AC_B,"temperature",[("把数值调成24度",24),("设定为20度",20),("目标改成27度",27)]),
  (LIGHT_L,"brightness",[("把亮度设成30%",30),("灯光调至70%",70),("亮度改为45%",45)]),
  (LIGHT_B,"brightness",[("把亮度设成55%",55),("灯光调至80%",80),("亮度改为25%",25)]),
  (WIN_L,"opening",[("把开度设成30%",30),("窗位调至70%",70),("开窗幅度改为45%",45)]),
 ]:
  for text,value in pairs:tr.append(r(text,"PATCH_SLOT",target,slot,value,lifecycle={"focused_target":target},family="contextual_slot"))
 # Relative matched pairs deliberately use wording absent from frozen V2.
 for target,slot,items in [
  (AC_L,"temperature",[("再凉一些",-1),("再暖一些",1)]),
  (AC_B,"temperature",[("调凉一档",-1),("调暖一档",1)]),
  (LIGHT_L,"brightness",[("光线再亮些",1),("光线再暗些",-1)]),
  (LIGHT_B,"brightness",[("亮度加一档",1),("亮度减一档",-1)]),
  (WIN_L,"opening",[("窗位再放开些",1),("窗位再收一些",-1)]),
 ]:
  for text,delta in items:tr.append(r(text,"PATCH_RELATIVE",target,slot,lifecycle={"focused_target":target},family="contextual_relative",delta=delta))
 return {"truth":"v11_contextual_matched_pairs_train_only","train":tr,"dev":d["dev"],"sealed":d["sealed"],"requirements":d["requirements"]}
if __name__=="__main__":
 import json;d=build();print(json.dumps({"truth":d["truth"],"train":len(d["train"]),"dev":len(d["dev"]),"sealed":len(d["sealed"])},ensure_ascii=False))
