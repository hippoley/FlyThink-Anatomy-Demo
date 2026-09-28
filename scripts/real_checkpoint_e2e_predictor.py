#!/usr/bin/env python3
"""Real checkpoint E2E predictor: utterance -> judgement -> semantic -> context-grounded patch."""
import argparse,json
from checkpoint_inference import Inference
from semantic_patch_materializer import materialize
from judgement_patch_pipeline import decide_and_compose
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",required=True);ap.add_argument("--judgement",required=True);ap.add_argument("--semantic",required=True);a=ap.parse_args()
 inf=Inference(a.graph,a.judgement,a.semantic)
 for line in __import__("sys").stdin:
  x=json.loads(line);text=x["text"];ctx=x.get("context",{});bg=x.get("background",ctx)
  j=inf.judgement(text,bg)
  if j["decision"]!="EXECUTE":
   out={"turn_id":x.get("turn_id"),"decision":j["decision"],"confidence":j["confidence"],"patches":[]}
  else:
   raw=inf.patch(text,ctx);sem=materialize(raw,text);out=decide_and_compose(j,sem,ctx)
   out.update({"turn_id":x.get("turn_id"),"judgement_confidence":j["confidence"],"semantic_raw":raw})
  print(json.dumps(out,ensure_ascii=False))
if __name__=="__main__":main()
