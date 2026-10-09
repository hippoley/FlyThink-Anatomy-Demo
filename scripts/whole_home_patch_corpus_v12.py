#!/usr/bin/env python3
"""V12 train-only curriculum derived from V3 failure taxonomy.

Frozen V10/V11 dev and sealed sets remain untouched. This file only adds
training rows with surface forms disjoint from Benchmark V3 sealed templates.
"""
from whole_home_patch_corpus_v11 import build as base_build
from whole_home_patch_corpus_v6 import r

ROOMS=["客厅","主卧","书房","次卧"]
TARGETS={
 ("客厅","空调"):{"area":"客厅","entity":"空调","instance":"default"},
 ("主卧","空调"):{"area":"主卧","entity":"空调","instance":"default"},
 ("书房","空调"):{"area":"书房","entity":"空调","instance":"default"},
 ("次卧","空调"):{"area":"次卧","entity":"空调","instance":"default"},
 ("客厅","灯"):{"area":"客厅","entity":"灯","instance":"default"},
 ("主卧","灯"):{"area":"主卧","entity":"灯","instance":"default"},
 ("书房","灯"):{"area":"书房","entity":"灯","instance":"default"},
 ("次卧","灯"):{"area":"次卧","entity":"灯","instance":"default"},
 ("客厅","窗"):{"area":"客厅","entity":"窗","instance":"default"},
 ("主卧","窗"):{"area":"主卧","entity":"窗","instance":"default"},
 ("书房","窗"):{"area":"书房","entity":"窗","instance":"default"},
 ("次卧","窗"):{"area":"次卧","entity":"窗","instance":"default"},
}

def t(room,entity): return TARGETS[(room,entity)]

def add_numeric(rows):
 specs=[
  ("空调","temperature","温控",[(18,"18度"),(22,"22度"),(27,"27度")]),
  ("灯","brightness","灯光强度",[(25,"25%"),(55,"55%"),(85,"85%")]),
  ("窗","opening","窗体开合度",[(20,"20%"),(50,"50%"),(75,"75%")]),
 ]
 for entity,slot,label,vals in specs:
  for i,room in enumerate(ROOMS):
   target=t(room,entity)
   for j,(value,shown) in enumerate(vals):
    text=[
     f"请把{room}{entity}的{label}直接设为{shown}",
     f"{room}{entity}{label}明确指定为{shown}",
     f"我要{room}{entity}最终{label}等于{shown}",
    ][(i+j)%3]
    rows.append(r(text,"PATCH_SLOT",target,slot,value,
      lifecycle={"focused_target":target},family="v12_numeric_assignment"))

def add_corrections(rows):
 cases=[
  ("客厅","书房","空调","temperature","温控",21,"21度"),
  ("主卧","次卧","灯","brightness","灯光强度",60,"60%"),
  ("次卧","客厅","窗","opening","窗体开合度",40,"40%"),
  ("书房","主卧","空调","temperature","温控",25,"25度"),
  ("客厅","次卧","灯","brightness","灯光强度",35,"35%"),
  ("主卧","书房","窗","opening","窗体开合度",65,"65%"),
 ]
 forms=[
  "前面目标说错了；这次实际处理{new}{entity}，{label}设为{shown}",
  "纠正刚才的房间：应当是{new}{entity}，请直接给{label}{shown}",
  "之前提到{old}不算，本轮明确改{new}{entity}的{label}为{shown}",
 ]
 for i,(old,new,entity,slot,label,value,shown) in enumerate(cases):
  target=t(new,entity)
  text=forms[i%len(forms)].format(old=old,new=new,entity=entity,label=label,shown=shown)
  rows.append(r(text,"PATCH_SLOT",target,slot,value,
    lifecycle={"focused_target":t(old,entity)},family="v12_explicit_correction"))

def add_multi(rows):
 specs=[
  ("空调","temperature","温控",23,"23度",("客厅","书房")),
  ("空调","temperature","温控",26,"26度",("主卧","次卧")),
  ("灯","brightness","灯光强度",70,"70%",("客厅","主卧")),
  ("灯","brightness","灯光强度",30,"30%",("书房","次卧")),
  ("窗","opening","窗体开合度",50,"50%",("客厅","书房")),
  ("窗","opening","窗体开合度",30,"30%",("主卧","次卧")),
 ]
 forms=[
  "请同步设置{a}和{b}的{entity}，两处{label}都设为{shown}",
  "{a}、{b}这两处{entity}一起处理：{label}分别设为同一个{shown}",
  "一次改两处：{a}{entity}与{b}{entity}的{label}都取{shown}",
 ]
 for i,(entity,slot,label,value,shown,(a,b)) in enumerate(specs):
  targets=[t(a,entity),t(b,entity)]
  text=forms[i%3].format(a=a,b=b,entity=entity,label=label,shown=shown)
  rows.append(r(text,"PATCH_SLOT",slot=slot,value=value,targets=targets,
    lifecycle={"referent_set":targets},family="v12_multi_target"))

def add_relative(rows):
 specs=[
  ("客厅","空调","temperature",-1,"稍微往冷的方向挪一档"),
  ("书房","空调","temperature",1,"在当前温控上加一档"),
  ("主卧","灯","brightness",-1,"保持刚选灯具不变，亮度减一档"),
  ("次卧","灯","brightness",1,"仍用当前灯具，亮度加一档"),
  ("客厅","窗","opening",-1,"沿用当前窗体，开合度收一档"),
  ("书房","窗","opening",1,"对象保持当前窗体，开合度放一档"),
 ]
 for room,entity,slot,delta,text in specs:
  target=t(room,entity)
  rows.append(r(text,"PATCH_RELATIVE",target,slot,delta=delta,
    lifecycle={"focused_target":target},family="v12_relative_coreference"))

def add_operation_contrasts(rows):
 # CLOSE vs REMOVE vs PROTECT use related "stop/keep/remove" semantics but
 # deliberately distinct task meaning. These are the exact confusions seen in
 # the pre-V3 frozen checkpoint, without reusing sealed utterances.
 targets=[t("客厅","空调"),t("主卧","灯"),t("书房","窗")]
 for target in targets:
  room,entity=target["area"],target["entity"]
  rows.append(r(f"让{room}{entity}停止工作但保留这个设备","CLOSE_DEVICE",
    target,"power","OFF",lifecycle={"focused_target":target},family="v12_close_not_remove"))
  rows.append(r(f"从当前任务清单彻底移除{room}{entity}","REMOVE_DEVICE",
    target,lifecycle={"focused_target":target},family="v12_remove_not_close"))
  slot={"空调":"temperature","灯":"brightness","窗":"opening"}[entity]
  rows.append(r(f"锁定{room}{entity}的这个参数，后续不要修改","PROTECT",
    target,slot,lifecycle={"focused_target":target},family="v12_protect_not_set"))
 # Replacement stays destructive and requires an old/new identity pair.
 for old,new in [(t("客厅","空调"),t("书房","空调")),(t("主卧","灯"),t("次卧","灯"))]:
  text=f"把当前目标整体替换成{new['area']}{new['entity']}，不是调整数值"
  x=r(text,"REPLACE_TARGET",new,lifecycle={"focused_target":old},family="v12_replace_not_correction")
  x["gold_patches"][0]["from"]=old;x["gold_patches"][0]["to"]=new
  rows.append(x)

def build():
 d=base_build();tr=list(d["train"])
 add_numeric(tr);add_corrections(tr);add_multi(tr);add_relative(tr);add_operation_contrasts(tr)
 return {
  "truth":"v12_v3_failure_taxonomy_train_only_curriculum",
  "train":tr,
  "dev":d["dev"],
  "sealed":d["sealed"],
  "requirements":list(d["requirements"])+[
   "benchmark_v3_sealed_surface_signature_overlap=0",
   "explicit_correction_is_not_replace",
   "multi_target_cardinality_supervised",
   "numeric_assignment_has_value_supervised",
   "operation_confusion_contrasts_present"
  ]
 }

if __name__=="__main__":
 import json
 from collections import Counter
 d=build()
 print(json.dumps({
  "truth":d["truth"],"train":len(d["train"]),"dev":len(d["dev"]),"sealed":len(d["sealed"]),
  "families":dict(Counter(x["family"] for x in d["train"]))
 },ensure_ascii=False))
