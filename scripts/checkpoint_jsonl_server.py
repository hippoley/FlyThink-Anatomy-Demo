#!/usr/bin/env python3
"""Persistent JSONL checkpoint server. Context arrives from actual JS runtime each turn."""
import argparse,json,sys
from checkpoint_inference import Inference
from context_slot_resolver import load
from checkpoint_runtime import predict

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--graph",required=True)
 ap.add_argument("--judgement",required=True)
 ap.add_argument("--semantic",required=True)
 a=ap.parse_args()
 inf=Inference(a.graph,a.judgement,a.semantic)
 index=load()
 for line in sys.stdin:
  x=json.loads(line)
  out=predict(inf,index,x["text"],x.get("context",{}),x.get("background",x.get("context",{})))
  print(json.dumps(out,ensure_ascii=False),flush=True)

if __name__=="__main__":main()
