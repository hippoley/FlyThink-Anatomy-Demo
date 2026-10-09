#!/usr/bin/env python3
import copy
from collections import Counter

from benchmark_v3_training_adapter import judgement_rows,semantic_rows
from context_judgement_corpus_v3 import build as judgement_v3
from context_judgement_corpus_v4 import build as judgement_v4
from whole_home_patch_corpus_v11 import build as semantic_v11
from whole_home_patch_corpus_v12 import build as semantic_v12

jt=judgement_rows("train",240);jd=judgement_rows("dev",120)
assert jt and jd
assert {x["source"]["split"] for x in jt}=={"train"}
assert {x["source"]["split"] for x in jd}=={"dev"}
assert not any(x["source"]["split"]=="sealed" for x in jt+jd)
jc=Counter(x["judgement"]["decision"] for x in jt)
assert jc["EXECUTE"]>0 and jc["CLARIFY"]>0
assert max(jc.values())/min(jc.values())<=1.5
for row in jt[:50]:
 assert "focused_target" in row["background"]
 assert "referent_set" in row["background"]
 assert "device_registry" in row["background"]

st=semantic_rows("train",140);sd=semantic_rows("dev",60)
assert st and sd
assert {x["source"]["split"] for x in st}=={"train"}
assert {x["source"]["split"] for x in sd}=={"dev"}
assert not any(x["source"]["split"]=="sealed" for x in st+sd)
families=Counter(x["family"] for x in st)
assert set(families)=={
 "v3_direct_slot","v3_direct_power","v3_relative_coreference",
 "v3_explicit_correction","v3_multi_target"
}
assert max(families.values())<=140
# Corrected V3.2: power-on for existing mounted devices is PATCH_SLOT, never ADD_DEVICE.
for row in st+sd:
 p=row["gold_patches"][0]
 if p["op"]=="ADD_DEVICE":
  raise AssertionError(("v3_2_adapter_must_not_emit_add_device",row))

oldj=judgement_v3();newj=judgement_v4()
assert newj["final"]==oldj["final"]
assert len(newj["train"])>len(oldj["train"]) and len(newj["dev"])>len(oldj["dev"])

olds=semantic_v11();news=semantic_v12()
assert news["sealed"]==olds["sealed"]
assert len(news["train"])>len(olds["train"]) and len(news["dev"])>len(olds["dev"])
print({
 "judgement_added_train":len(newj["train"])-len(oldj["train"]),
 "judgement_added_dev":len(newj["dev"])-len(oldj["dev"]),
 "semantic_added_train":len(news["train"])-len(olds["train"]),
 "semantic_added_dev":len(news["dev"])-len(olds["dev"]),
 "judgement_decisions":dict(jc),
 "semantic_families":dict(families),
})
