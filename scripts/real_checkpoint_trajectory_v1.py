#!/usr/bin/env python3
"""Frozen natural-language checkpoint probe with real Thing Model bindings."""

L={"area":"客厅","entity":"空调","instance":"default"}
B={"area":"主卧","entity":"空调","instance":"default"}
W={"area":"客厅","entity":"窗","instance":"default"}

DEVICE_REGISTRY={
 "客厅::空调::default":{"model_id":"AWGD-ZA01"},
 "主卧::空调::default":{"model_id":"AWGD-ZA01"},
 "客厅::窗::default":{"model_id":"CWDS-CA01"},
}

def ctx(**kwargs):
 return {"device_registry":DEVICE_REGISTRY,**kwargs}

def build():
 return [{"id":"checkpoint-smoke-01","turns":[
  {"text":"把它关掉","context":ctx(focused_target=L),"gold_decision":"EXECUTE","gold_target":L,"family":"focus"},
  {"text":"卧室的也打开","context":ctx(focused_target=L,add_target=B),"gold_decision":"EXECUTE","gold_target":B,"family":"additive"},
  {"text":"温度调到23度","context":ctx(focused_target=B),"gold_decision":"EXECUTE","gold_target":B,"family":"value"},
  {"text":"再低一点","context":ctx(focused_target=B),"gold_decision":"EXECUTE","gold_target":B,"family":"relative"},
  {"text":"这两个都调到23度","context":ctx(referent_set=[L,B]),"gold_decision":"EXECUTE","family":"set"},
  {"text":"把它关掉","context":ctx(),"gold_decision":"CLARIFY","family":"missing_referent"},
  {"text":"刚才那个不要了","context":ctx(pending_ids=["p1"]),"background":{"pending":["p1"]},"gold_decision":"CANCEL_PENDING","family":"lifecycle"},
  {"text":"上一条撤销","context":ctx(executed_ids=["e1"]),"background":{"executed":["e1"]},"gold_decision":"UNDO_EXECUTED","family":"lifecycle"},
  {"text":"窗户再开大一点","context":ctx(focused_target=W),"background":{"focus":W,"rain":False},"gold_decision":"EXECUTE","gold_target":W,"family":"relative"},
  {"text":"把它关掉","context":ctx(focused_target=B),"background":{"focus":B},"gold_decision":"EXECUTE","gold_target":B,"family":"focus"},
 ]}]

if __name__=="__main__":
 import json
 print(json.dumps(build(),ensure_ascii=False))
