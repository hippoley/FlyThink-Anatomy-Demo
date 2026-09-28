#!/usr/bin/env python3
"""Persistent JSONL checkpoint server. Context arrives from actual JS runtime each turn."""
import argparse,json,sys
from checkpoint_inference import Inference
from semantic_patch_materializer import materialize
from judgement_patch_pipeline import decide_and_compose
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",required=True);ap.add_argument("--judgement",required=True);ap.add_argument("--semantic",required=True);a=ap.parse_args()
 inf=Inference(a.graph,a.judgement,a.semantic)
 for line in sys.stdin:
  x=json.loads(line);t=x["text"];ctx=x.get("context",{});bg=x.get("background",ctx)
  j=inf.judgement(t,bg)
  if j["decision"]!="EXECUTE":out={"decision":j["decision"],"patches":[],"confidence":j["confidence"]}
  else:
   raw=inf.patch(t,ctx);sem=materialize(raw,t);out=decide_and_compose(j,sem,ctx);out["semantic_raw"]=raw;out["confidence"]=j["confidence"]
  print(json.dumps(out,ensure_ascii=False),flush=True)
if __name__=="__main__":main()
