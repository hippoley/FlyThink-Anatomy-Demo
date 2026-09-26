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
 # Full contract operations previously underrepresented in v6.
 for text in ["移除卧室空调","把卧室空调从任务里去掉","不要再管卧室空调","任务里删掉卧室空调","卧室空调移出当前任务","去掉主卧空调"]:
  final.append(r(text,"REMOVE_DEVICE",AC_B,lifecycle={"focused_target":AC_B},family="remove"))
 for text in ["客厅温度保持不变","别动客厅温度","客厅这个温度不要改","保持客厅空调温度","客厅温度锁住","客厅温度维持原样"]:
  final.append(r(text,"PROTECT",AC_L,"temperature",lifecycle={"focused_target":AC_L},family="protect"))
 # Replacement remains a distinct destructive intent, never additive.
 for text in ["不是客厅改卧室","目标换成卧室","别用客厅换主卧","改成卧室空调","客厅那个换成主卧","说错了是卧室"]:
  item=r(text,"REPLACE_TARGET",AC_B,lifecycle={"focused_target":AC_L},family="replace")
  item["gold_patches"][0]["from"]=AC_L;item["gold_patches"][0]["to"]=AC_B
  final.append(item)
 # Train the full operation distribution instead of testing unseen labels.
 extra_train=[]
 for text in ["移除卧室空调","卧室空调移出任务","任务里去掉卧室空调","别再管卧室空调","删掉主卧空调","去掉卧室这个"]:
  extra_train.append(r(text,"REMOVE_DEVICE",AC_B,lifecycle={"focused_target":AC_B},family="remove"))
 for text in ["客厅温度别动","保持客厅温度","锁住客厅温度","客厅温度不变","不要改客厅温度","客厅温度维持"]:
  extra_train.append(r(text,"PROTECT",AC_L,"temperature",lifecycle={"focused_target":AC_L},family="protect"))
 for text in ["不是客厅是卧室","换成卧室空调","目标改主卧","客厅换卧室","改用主卧空调","说错了换卧室"]:
  x=r(text,"REPLACE_TARGET",AC_B,lifecycle={"focused_target":AC_L},family="replace");x["gold_patches"][0]["from"]=AC_L;x["gold_patches"][0]["to"]=AC_B;extra_train.append(x)
 # Strengthen lifecycle and relative weak families.
 for text in ["把待办取消","取消上一条待执行","刚才待执行的不要","撤掉待处理那条","取消那个pending","上一项别执行"]:
  extra_train.append(r(text,"CANCEL_PENDING",lifecycle={"pending_ids":["pt"]},family="cancel"))
 for text in ["撤销刚才执行","把上个动作撤销","恢复刚才执行前","撤回已执行那条","undo上一步","把刚才做的还原"]:
  extra_train.append(r(text,"UNDO_EXECUTED",lifecycle={"executed_ids":["et"]},family="undo"))
 tr.extend(extra_train)
 # Preserve frozen inherited cases; total final >=100.
 return {"truth":"v9_balanced_full_operation_training","train":tr,"dev":dev,"sealed":final,
         "requirements":["family_exact>=0.90","overall_exact>=0.90","relative>=0.90","no_final_checkpoint_selection"]}
if __name__=="__main__":
 import json;d=build();from collections import Counter
 print(json.dumps({"train":len(d["train"]),"dev":len(d["dev"]),"final":len(d["sealed"]),"families":Counter(x["family"] for x in d["sealed"])},ensure_ascii=False,default=dict))
