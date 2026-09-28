#!/usr/bin/env python3
"""JSONL boundary between learned predictor and persistent runtime."""
import json,sys
from judgement_patch_pipeline import decide_and_compose
def emit(turn_id,judgement,semantic,context):
 out=decide_and_compose(judgement,semantic,context)
 return {"turn_id":turn_id,"decision":out["decision"],"patches":out.get("patches",[]),"reason":out.get("reason"),"context":context}
if __name__=="__main__":
 for line in sys.stdin:
  x=json.loads(line);print(json.dumps(emit(x["turn_id"],x["judgement"],x.get("semantic",{}),x.get("context",{})),ensure_ascii=False))
