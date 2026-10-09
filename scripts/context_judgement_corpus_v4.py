#!/usr/bin/env python3
"""V4: existing judgement corpus + V3.2 train/dev online-shape context."""
from context_judgement_corpus_v3 import build as base_build
from benchmark_v3_training_adapter import judgement_rows

def build():
 d=base_build()
 train=list(d["train"])+judgement_rows("train",240)
 dev=list(d["dev"])+judgement_rows("dev",120)
 return {
  "truth":"long_context_judgement_v4_v3_2_train_dev_adapter",
  "train":train,"dev":dev,"final":d["final"]
 }

if __name__=="__main__":
 import json
 d=build();print(json.dumps({k:len(v) if isinstance(v,list) else v for k,v in d.items()},ensure_ascii=False))
