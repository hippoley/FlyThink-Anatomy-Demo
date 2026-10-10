#!/usr/bin/env python3
"""V12: V11 plus bounded V3.2 train/dev semantic rows; inherited sealed stays frozen."""
from whole_home_patch_corpus_v11 import build as base_build
from benchmark_v3_training_adapter import semantic_rows

def build():
 d=base_build()
 return {
  "truth":"v12_v3_2_train_dev_adapter",
  "train":list(d["train"])+semantic_rows("train",140),
  "dev":list(d["dev"])+semantic_rows("dev",60),
  "sealed":d["sealed"],
  "requirements":d["requirements"]+[
   "v3_2_train_dev_only","no_v3_sealed_training","bounded_family_sampling"
  ]
 }

if __name__=="__main__":
 import json
 d=build();print(json.dumps({"truth":d["truth"],"train":len(d["train"]),"dev":len(d["dev"]),"sealed":len(d["sealed"])},ensure_ascii=False))
