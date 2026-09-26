#!/usr/bin/env python3
"""Large deterministic benchmark expansion for whole-home incremental semantics.
Creates balanced compositional cases rather than duplicated paraphrases.
"""
from whole_home_patch_corpus_v6 import build as base_build,r,AC_L,AC_B,WIN_L
LIGHT_B={"area":"主卧","entity":"灯","instance":"default"}

def build():
 d=base_build();tr=list(d["train"]);dev=list(d["dev"]);final=list(d["sealed"])
 # 24 relative: 2 slots x 2 directions x 6 unseen forms
 rel={
  ("temperature",-1):["温度往下调","温度降一些","冷一点","再冷些","温度少一点","往低调一点"],
  ("temperature",1):["温度往上调","温度升一些","热一点","再热些","温度多一点","往高调一点"],
  ("opening",-1):["开度往小调","窗开小些","收小一点","再合一点","开度减少","往回收一点"],
  ("opening",1):["开度往大调","窗开大些","放开一点","再开一点","开度增加","往外开一点"],
 }
 for (slot,delta),texts in rel.items():
  target=AC_L if slot=="temperature" else WIN_L
  for text in texts: final.append(r(text,"PATCH_RELATIVE",target,slot,delta=delta,lifecycle={"focused_target":target},family="relative"))
 # 12 focus counterfactuals: same surface, target changes only by context
 for text in ["把它关了","这个先关掉","先停这个","把当前这个关掉"]:
  for target in [AC_L,AC_B,WIN_L]: final.append(r(text,"CLOSE_DEVICE",target,"power","OFF",lifecycle={"focused_target":target},family="focus"))
 # 12 lifecycle counterfactuals
 for text in ["刚才那个算了","前一个不要","撤掉上一条","刚那项撤掉","不要刚才的","前面那个作废"]:
  final.append(r(text,"CANCEL_PENDING",lifecycle={"pending_ids":["px"]},family="cancel"))
  final.append(r(text,"UNDO_EXECUTED",lifecycle={"executed_ids":["ex"]},family="undo"))
 # 12 additive, surface cues distinct from replace
 for text in ["卧室也打开","主卧的也来","再开卧室","卧室一起开","另外打开卧室","顺便开主卧","卧室同样打开","主卧也保持开着","再加一个卧室空调","卧室空调也启动","把卧室也带上","还有卧室那个"]:
  final.append(r(text,"ADD_DEVICE",AC_B,"power","ON",lifecycle={"focused_target":AC_L},family="additive"))
 # 12 set cases
 for text in ["两个都开","两个一起开","这俩都开","这两个一起开","客厅卧室都开","两台空调都开","它们都打开","这两台启动","两个全部打开","两边都开","两台一起启动","客卧两个都开"]:
  final.append(r(text,"PATCH_SLOT",slot="power",value="ON",targets=[AC_L,AC_B],lifecycle={"referent_set":[AC_L,AC_B]},family="set"))
 # Preserve frozen inherited cases; total final >=80.
 return {"truth":"v8_large_compositional_final","train":tr,"dev":dev,"sealed":final,
         "requirements":["family_exact>=0.90","overall_exact>=0.90","relative>=0.90","no_final_checkpoint_selection"]}
if __name__=="__main__":
 import json;d=build();from collections import Counter
 print(json.dumps({"train":len(d["train"]),"dev":len(d["dev"]),"final":len(d["sealed"]),"families":Counter(x["family"] for x in d["sealed"])},ensure_ascii=False,default=dict))
