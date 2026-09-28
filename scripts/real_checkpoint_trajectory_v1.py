#!/usr/bin/env python3
"""First persistent natural-language checkpoint trajectory corpus."""
L={"area":"客厅","entity":"空调","instance":"default"};B={"area":"主卧","entity":"空调","instance":"default"};W={"area":"客厅","entity":"窗户","instance":"default"}
def build():
 return [{"id":"checkpoint-smoke-01","turns":[
  {"text":"把它关掉","context":{"focused_target":L},"gold_decision":"EXECUTE","family":"focus"},
  {"text":"卧室的也打开","context":{"focused_target":L},"gold_decision":"EXECUTE","family":"additive"},
  {"text":"温度调到23度","context":{"focused_target":B},"gold_decision":"EXECUTE","family":"value"},
  {"text":"再低一点","context":{"focused_target":B},"gold_decision":"EXECUTE","family":"relative"},
  {"text":"这两个都调到23度","context":{"referent_set":[L,B]},"gold_decision":"EXECUTE","family":"set"},
  {"text":"把它关掉","context":{},"gold_decision":"CLARIFY","family":"missing_referent"},
  {"text":"刚才那个不要了","context":{"pending_ids":["p1"]},"background":{"pending":["p1"]},"gold_decision":"CANCEL_PENDING","family":"lifecycle"},
  {"text":"上一条撤销","context":{"executed_ids":["e1"]},"background":{"executed":["e1"]},"gold_decision":"UNDO_EXECUTED","family":"lifecycle"},
  {"text":"窗户再开大一点","context":{"focused_target":W},"background":{"focus":W,"rain":False},"gold_decision":"EXECUTE","family":"relative"},
  {"text":"把它关掉","context":{"focused_target":B},"gold_decision":"EXECUTE","family":"focus"},
 ]}]
if __name__=="__main__":
 import json;print(json.dumps(build(),ensure_ascii=False))
