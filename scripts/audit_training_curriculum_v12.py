#!/usr/bin/env python3
"""Audit V12/V4 curriculum integrity and Benchmark V3 sealed isolation."""
import json,random,re,sys
from collections import Counter
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[0]))

from whole_home_patch_corpus_v11 import build as semantic_v11
from whole_home_patch_corpus_v12 import build as semantic_v12
from context_judgement_corpus_v3 import build as judgement_v3
from context_judgement_corpus_v4 import build as judgement_v4
from semantic_patch_contract import encode
from generate_long_trajectory_benchmark_v3 import make,release_seed,assert_template_isolation

ROOM=r"客厅|主卧|书房|次卧"
ENTITY=r"空调|灯|窗户|窗"
def signature(text):
 s="".join(str(text).split()).lower()
 s=re.sub(ROOM,"<ROOM>",s)
 s=re.sub(ENTITY,"<ENTITY>",s)
 s=re.sub(r"\d+(?:\.\d+)?","<N>",s)
 s=re.sub(r"[，。；、,:：;!！?？%％]","",s)
 return s

def benchmark_sealed(release_id="2026-10",count=180):
 assert_template_isolation()
 rng=random.Random(release_seed(release_id))
 rows=[make(i,count,rng) for i in range(count)]
 return [t for tr in rows if tr["split"]=="sealed" for t in tr["turns"]]

def main():
 s11=semantic_v11();s12=semantic_v12();j3=judgement_v3();j4=judgement_v4()
 assert s12["dev"]==s11["dev"],"V12 modified frozen semantic dev"
 assert s12["sealed"]==s11["sealed"],"V12 modified frozen semantic sealed"
 assert j4["dev"]==j3["dev"],"V4 modified frozen judgement dev"
 assert j4["final"]==j3["final"],"V4 modified frozen judgement final"
 assert len(s12["train"])>len(s11["train"])
 assert len(j4["train"])>len(j3["train"])

 added_s=s12["train"][len(s11["train"]):]
 added_j=j4["train"][len(j3["train"]):]
 sealed=benchmark_sealed()
 sealed_texts={signature(t["text"]) for t in sealed}
 semantic_overlap=sorted({signature(x["text"]) for x in added_s}&sealed_texts)
 judgement_overlap=sorted({signature(x["utterance"]) for x in added_j}&sealed_texts)
 assert not semantic_overlap,("semantic V12 leaks sealed structural surfaces",semantic_overlap)
 assert not judgement_overlap,("judgement V4 leaks sealed structural surfaces",judgement_overlap)

 fam=Counter(x["family"] for x in added_s)
 for required in [
  "v12_numeric_assignment","v12_explicit_correction","v12_multi_target",
  "v12_relative_coreference","v12_close_not_remove","v12_remove_not_close",
  "v12_protect_not_set","v12_replace_not_correction"
 ]:
  assert fam[required]>0,required

 for row in added_s:
  enc=encode(row)
  family=row["family"]
  if family=="v12_numeric_assignment":
   assert enc["op"]=="PATCH_SLOT" and enc["has_value"] is True
  if family=="v12_explicit_correction":
   assert enc["op"]=="PATCH_SLOT" and enc["has_value"] is True
  if family=="v12_multi_target":
   assert enc["op"]=="PATCH_SLOT" and enc["cardinality"]=="SET" and enc["has_value"] is True
  if family=="v12_relative_coreference":
   assert enc["op"]=="PATCH_RELATIVE" and enc["direction"] in ("NEG","POS")
  if family=="v12_close_not_remove":
   assert enc["op"]=="CLOSE_DEVICE"
  if family=="v12_remove_not_close":
   assert enc["op"]=="REMOVE_DEVICE"
  if family=="v12_protect_not_set":
   assert enc["op"]=="PROTECT"
  if family=="v12_replace_not_correction":
   assert enc["op"]=="REPLACE_TARGET"

 jf=Counter(x["family"] for x in added_j)
 for required in [
  "explicit_correction","explicit_multi_target","explicit_direct",
  "multi_referent_ambiguity","single_focus_relative"
 ]:
  assert jf[required]>0,required
 for row in added_j:
  if row["family"] in ("explicit_correction","explicit_multi_target","explicit_direct","single_focus_relative"):
   assert row["judgement"]["decision"]=="EXECUTE"
  if row["family"]=="multi_referent_ambiguity":
   assert row["judgement"]["decision"]=="CLARIFY"

 report={
  "ok":True,
  "semantic_train_before":len(s11["train"]),
  "semantic_train_after":len(s12["train"]),
  "semantic_added":len(added_s),
  "semantic_added_families":dict(sorted(fam.items())),
  "judgement_train_before":len(j3["train"]),
  "judgement_train_after":len(j4["train"]),
  "judgement_added":len(added_j),
  "judgement_added_families":dict(sorted(jf.items())),
  "semantic_frozen_dev_unchanged":True,
  "semantic_frozen_sealed_unchanged":True,
  "judgement_frozen_dev_unchanged":True,
  "judgement_frozen_final_unchanged":True,
  "v3_sealed_turns":len(sealed),
  "normalized_surface_overlap":{"semantic":0,"judgement":0},
  "contract":"train-only curriculum closes observed taxonomy gaps without reusing V3 sealed structural surfaces"
 }
 print(json.dumps(report,ensure_ascii=False))

if __name__=="__main__":main()
