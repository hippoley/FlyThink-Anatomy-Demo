#!/usr/bin/env python3
"""Persistent JSONL checkpoint server. Context arrives from actual JS runtime each turn."""
import argparse,json,sys
from checkpoint_inference import Inference
from semantic_patch_materializer import materialize
from judgement_patch_pipeline import decide_and_compose
from context_slot_resolver import load,resolve_slot
from lexical_operation_evidence import operation_evidence
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",required=True);ap.add_argument("--judgement",required=True);ap.add_argument("--semantic",required=True);a=ap.parse_args()
 inf=Inference(a.graph,a.judgement,a.semantic);index=load()
 for line in sys.stdin:
  x=json.loads(line);t=x["text"];ctx=x.get("context",{});bg=x.get("background",ctx)
  j=inf.judgement(t,bg);ev=operation_evidence(t)
  # A resolved target plus an unambiguous actuator verb is executable evidence; missing referent still fails closed.
  if ev and (ctx.get("focused_target") or ctx.get("add_target") or ctx.get("referent_set")) and j["decision"]=="CLARIFY":
   j={"decision":"EXECUTE","confidence":j["confidence"],"override":{"from":"CLARIFY","evidence":ev}}
  if j["decision"]!="EXECUTE":out={"decision":j["decision"],"patches":[],"confidence":j["confidence"]}
  else:
   raw=inf.patch(t,ctx)
   if ev and raw.get("op")!=ev["op"]:raw={**raw,"op":ev["op"],"operation_override":ev}
   sem=materialize(raw,t);resolver=lambda p,target,c,text="":resolve_slot(p,target,c,index,text)
   out=decide_and_compose(j,sem,ctx,resolver,t);out["semantic_raw"]=raw;out["confidence"]=j["confidence"]
  print(json.dumps(out,ensure_ascii=False),flush=True)
if __name__=="__main__":main()
