#!/usr/bin/env python3
"""Persistent JSONL checkpoint server. Context arrives from actual JS runtime each turn."""
import argparse,json,sys
from context_slot_resolver import load
from checkpoint_runtime import predict

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--backend",choices=["neural","sklearn"],default="neural")
 ap.add_argument("--graph")
 ap.add_argument("--judgement",required=True)
 ap.add_argument("--semantic",required=True)
 a=ap.parse_args()
 if a.backend=="neural":
  if not a.graph:raise SystemExit("--graph is required for neural backend")
  from checkpoint_inference import Inference
  inf=Inference(a.graph,a.judgement,a.semantic)
 else:
  from sklearn_checkpoint_inference import SklearnInference
  inf=SklearnInference(a.judgement,a.semantic)
 index=load()
 for line in sys.stdin:
  x=json.loads(line)
  out=predict(inf,index,x["text"],x.get("context",{}),x.get("background",x.get("context",{})))
  print(json.dumps(out,ensure_ascii=False),flush=True)

if __name__=="__main__":main()
