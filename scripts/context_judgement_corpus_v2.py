#!/usr/bin/env python3
"""Long-context judgement corpus: context changes the correct decision."""
def ex(bg,utterance,decision,family,evidence=(),missing=(),protected=()):
 return {"background":bg,"utterance":utterance,"judgement":{"decision":decision,"reason":family,"evidence":list(evidence),"missing":list(missing),"protected":list(protected)},"family":family}

def build():
 train=[];dev=[];final=[]
 # Same utterance, different context -> different judgement.
 contexts=[
  ({"focus":"客厅空调","pending":["p1"],"executed":[]},"刚才那个不要了","CANCEL_PENDING","lifecycle"),
  ({"focus":"客厅空调","pending":[],"executed":["e1"]},"刚才那个不要了","UNDO_EXECUTED","lifecycle"),
  ({"focus":None,"pending":[],"executed":[]},"把它关掉","CLARIFY","missing_referent"),
  ({"focus":"客厅空调","pending":[],"executed":[]},"把它关掉","EXECUTE","resolved_referent"),
  ({"focus":"客厅窗户","rain":True,"protected":["客厅窗户.opening"]},"窗户再开大一点","BLOCK","protected_conflict"),
  ({"focus":"客厅窗户","rain":False,"protected":[]},"窗户再开大一点","EXECUTE","sensor_context"),
  ({"focus":"客厅空调","occupancy":"away","automation":"eco"},"温度调到18度","CLARIFY","policy_conflict"),
  ({"focus":"客厅空调","occupancy":"home","automation":"manual"},"温度调到23度","EXECUTE","policy_context"),
  ({"focus":"主卧灯","speaker":"child","quiet_hours":True},"全屋灯都打开","CLARIFY","speaker_policy"),
  ({"focus":"主卧灯","speaker":"owner","quiet_hours":False},"全屋灯都打开","EXECUTE","speaker_policy"),
 ]
 # Long irrelevant histories force evidence selection, not keyword-only classification.
 noise=["电视昨晚看了两小时","厨房灯昨天换过亮度","客厅CO2上午偏高","卧室窗帘早上打开过","玄关传感器电量正常","天气预报明天降温"]
 for i in range(120):
  bg=dict(contexts[i%len(contexts)][0]);bg["history"]=[noise[(i+j)%len(noise)] for j in range(6+(i%12))]
  utt,dec,fam=contexts[i%len(contexts)][1:]
  row=ex(bg,utt,dec,fam,evidence=[f"context:{fam}"],missing=["referent"] if dec=="CLARIFY" and fam=="missing_referent" else [],protected=bg.get("protected",[]))
  (train if i<80 else dev if i<100 else final).append(row)
 # Hard-train the three weak counterfactual families without touching final wording.
 for i,text in enumerate(["待处理那条别做了","取消还没执行的那个","上一条待办作废","刚排队的不要执行","撤掉待执行动作","别执行刚才排的"]):
  train.append(ex({"pending":[f"p{i}"],"executed":[],"focus":"客厅空调","history":noise*(1+i%3)},text,"CANCEL_PENDING","lifecycle",evidence=["pending"]))
 for i,text in enumerate(["把已经做的撤回","还原上一个执行","撤销刚执行动作","恢复执行前状态","上个已完成动作撤掉","undo刚才执行"]):
  train.append(ex({"pending":[],"executed":[f"e{i}"],"focus":"客厅空调","history":noise*(1+i%3)},text,"UNDO_EXECUTED","lifecycle",evidence=["executed"]))
 for text in ["关掉它","把这个停了","这个关闭","先关这个","它先别开了","停一下这个"]:
  train.append(ex({"focus":None,"history":noise*3},text,"CLARIFY","missing_referent",evidence=[],missing=["referent"]))
 for text in ["再开大点","窗户多开一些","继续开一点","开度增加点","往外开些","窗再开些"]:
  train.append(ex({"focus":"客厅窗户","rain":True,"protected":["客厅窗户.opening"],"history":noise*3},text,"BLOCK","protected_conflict",evidence=["rain","protected"],protected=["客厅窗户.opening"]))
 # True final counterfactuals with unseen wording/background lengths.
 finals=[
  ({"focus":None,"history":noise*4},"这个关掉","CLARIFY","missing_referent"),
  ({"focus":"主卧空调","history":noise*3},"这个关掉","EXECUTE","resolved_referent"),
  ({"pending":["q9"],"executed":[],"history":noise*2},"上一条算了","CANCEL_PENDING","lifecycle"),
  ({"pending":[],"executed":["z9"],"history":noise*2},"上一条算了","UNDO_EXECUTED","lifecycle"),
  ({"focus":"客厅窗户","rain":True,"protected":["客厅窗户.opening"],"history":noise*3},"再开大些","BLOCK","protected_conflict"),
  ({"focus":"客厅窗户","rain":False,"protected":[],"history":noise*3},"再开大些","EXECUTE","sensor_context"),
 ]
 for bg,u,d,f in finals: final.append(ex(bg,u,d,f,evidence=[f"context:{f}"],missing=["referent"] if d=="CLARIFY" and f=="missing_referent" else [],protected=bg.get("protected",[])))
 return {"truth":"long_context_counterfactual_judgement_v2_hard_families","train":train,"dev":dev,"final":final}
if __name__=="__main__":
 import json;d=build();print(json.dumps({k:len(v) if isinstance(v,list) else v for k,v in d.items()},ensure_ascii=False))
