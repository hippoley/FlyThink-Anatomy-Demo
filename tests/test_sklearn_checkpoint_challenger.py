#!/usr/bin/env python3
import pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))

from train_sklearn_checkpoint_challenger import (
 flatten,judgement_text,semantic_text,semantic_labels
)
from context_judgement_corpus_v4 import build as judgement_build
from whole_home_patch_corpus_v12 import build as semantic_build

out=[];flatten("ctx",{"b":2,"a":{"x":["z",1]}},out)
assert out==["ctx.a.x=z","ctx.a.x=1","ctx.b=2"]

j=judgement_build()
assert j["train"] and j["dev"] and j["final"]
assert "utterance=" in judgement_text(j["train"][0])
assert "ctx." in judgement_text(j["train"][0])

s=semantic_build()
assert s["train"] and s["dev"] and s["sealed"]
labels=semantic_labels(s["train"][:5])
assert set(labels)=={"op","cardinality","direction","has_value"}
assert all(len(v)==5 for v in labels.values())
assert "utterance=" in semantic_text(s["train"][0])

# V3.2 sealed remains evaluation-only in the upstream adapter. Challenger reads
# the existing corpus contract and never imports raw Benchmark V3 sealed rows.
assert "v3_2_train_dev_only" in s["requirements"]
assert "no_v3_sealed_training" in s["requirements"]

print("sklearn-checkpoint-challenger-contract PASS")
