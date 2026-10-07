#!/usr/bin/env python3
"""Frozen V5 failure taxonomy. Diagnostic only: never used for model selection."""
import json,sys
from pathlib import Path
def classify(r):
 out={}
 for regime,runs in r["regimes"].items():
  agg={"room_rank_only":0,"entity_only":0,"composition_only":0,"multiple":0,"correct":0,"n":0}
  # Existing report exposes aggregate factors but not per-row target/entity predictions.
  # Record what can be proven without re-training or peeking into corpus labels.
  a=r["aggregate"][regime]["test"]
  out[regime]={
   "test_target_exact":a["target"],"test_room_predk":a["room_predk"],"test_entity_exact":a["entity"],"test_slot_exact":a["slot"],
   "cardinality_exact":a["room_count"],"over_selection":a["over_selection"],"under_selection":a["under_selection"],
   "attribution":"composition/ranking bottleneck" if a["slot"]==1 and a["room_count"]==1 else "mixed"
  }
 return out
def main():
 p=Path(sys.argv[1]);r=json.loads(p.read_text());print(json.dumps({"truth":"frozen_v5_posthoc_failure_attribution_v1","source_truth":r["truth"],"diagnostic_only":True,"result":classify(r)},ensure_ascii=False,indent=2))
if __name__=="__main__":main()
