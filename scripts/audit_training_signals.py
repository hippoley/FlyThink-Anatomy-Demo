#!/usr/bin/env python3
"""Audit whether an objective actually has supervision before spending a training run."""
import sys,json
sys.path.insert(0,"scripts")
from whole_home_patch_corpus_v11 import build as semantic_build
from contextual_state_transition_corpus_v1 import build as transition_build
from training_objectives import semantic_contrast_pairs,semantic_invariance_pairs,resolution_contrast_groups
s=semantic_build()["train"];t=transition_build()["examples"]
r={"semantic_rows":len(s),"transition_rows":len(t),
   "semantic_contrast_pairs":len(semantic_contrast_pairs(s)),
   "semantic_invariance_pairs":len(semantic_invariance_pairs(s)),
   "resolution_contrast_groups":sorted(resolution_contrast_groups(t))}
print(json.dumps(r,ensure_ascii=False))
assert r["semantic_invariance_pairs"]>0,"no semantic invariance signal"
assert r["resolution_contrast_groups"],"no resolution contrast signal"
