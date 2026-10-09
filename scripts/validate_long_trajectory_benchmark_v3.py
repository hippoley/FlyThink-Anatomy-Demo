#!/usr/bin/env python3
import argparse,collections,hashlib,json,re

LEGACY_RELEASE_SHA256={
 "2026-10":"e73f8ad72b0e2fe1d667f64c4a78e16ad9c867a8a23b8dd84578f18436b378a0",
}

def norm_text(s):
 return re.sub(r"\s+","",str(s)).lower()

def diff_state(prev,gold):
 out=[]
 for k in sorted(set(prev)|set(gold)):
  a=prev.get(k,{});b=gold.get(k,{})
  for slot in sorted(set(a)|set(b)):
   if a.get(slot)!=b.get(slot):out.append(f"devices.{k}.slots.{slot}")
 return out

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("path",nargs="?",default="benchmarks/long_trajectories_v3.json")
 a=ap.parse_args()
 d=json.load(open(a.path,encoding="utf8"));m=d["manifest"];ts=d["trajectories"]
 assert m["truth"]=="whole_home_long_trajectory_generalization_v3"
 release=m.get("release_id","")
 assert re.fullmatch(r"[0-9]{4}-[0-9]{2}(?:-r[1-9][0-9]*)?",release)
 if release in LEGACY_RELEASE_SHA256:
  assert m.get("generator_version")=="long-trajectory-v3.1"
  assert "semantic_profile" not in m
  assert m.get("sha256")==LEGACY_RELEASE_SHA256[release],"legacy release manifest SHA drift"
 else:
  assert m.get("generator_version")=="long-trajectory-v3.2"
  assert m.get("semantic_profile")=="existing_device_power_v3_2"
 assert len(ts)>=60 and set(x["split"] for x in ts)=={"train","dev","sealed"}
 raw=json.dumps(ts,ensure_ascii=False,separators=(",",":"),sort_keys=True).encode()
 assert hashlib.sha256(raw).hexdigest()==m["sha256"],"manifest sha256 does not bind trajectories"

 by_split=collections.defaultdict(list);texts=collections.defaultdict(set);text_freq=collections.defaultdict(collections.Counter);templates=collections.defaultdict(set)
 family=collections.Counter();decision=collections.Counter();difficulty=collections.Counter();generalization=collections.Counter();sealed_generalization=collections.Counter()
 naming=collections.Counter();shape=collections.Counter();naming_by_split=collections.defaultdict(collections.Counter)
 pairs=collections.defaultdict(set);turns=0
 for tr in ts:
  split=tr["split"];by_split[split].append(tr)
  expected=set(tr["initial_runtime"]["devices"])
  assert len(expected)==m["devices_per_home"]
  prev={k:v["slots"] for k,v in tr["initial_runtime"]["devices"].items()}
  for idx,t in enumerate(tr["turns"]):
   turns+=1;family[t["scenario_family"]]+=1;decision[t["gold_decision"]]+=1;difficulty[t["difficulty"]]+=1
   generalization[t["generalization_class"]]+=1
   if split=="sealed":sealed_generalization[t["generalization_class"]]+=1
   if release in LEGACY_RELEASE_SHA256:
    assert "surface_naming_class" not in t and "instruction_shape" not in t
   else:
    nc=t.get("surface_naming_class");sh=t.get("instruction_shape")
    assert nc in ("canonical","non_standard_alias","not_mentioned","not_applicable")
    assert sh in ("single_intent","multi_intent","omitted_attribute","underspecified_target")
    naming[nc]+=1;shape[sh]+=1;naming_by_split[split][nc]+=1
   nt=norm_text(t["text"]);texts[split].add(nt);text_freq[split][nt]+=1
   templates[split].add(t["surface_template_id"])
   assert set(t["gold_state"])==expected
   observed=diff_state(prev,t["gold_state"])
   assert sorted(observed)==sorted(t["gold_write_set"]),(t["turn_id"],observed,t["gold_write_set"])
   if t["scenario_family"]=="direct_power":
    if release in LEGACY_RELEASE_SHA256:
     assert t["gold_op"] in ("ADD_DEVICE","CLOSE_DEVICE")
    else:
     assert t["gold_op"] in ("PATCH_SLOT","CLOSE_DEVICE")
     assert t["gold_op"]!="ADD_DEVICE","existing device power-on must not be ADD_DEVICE"
     if t["gold_op"]=="PATCH_SLOT":
      assert t.get("gold_slot")=="power" and t.get("gold_value")=="ON"
   if t["gold_decision"]!="EXECUTE":
    assert not observed and not t["gold_write_set"],"non-execute turn mutated state"
    basis=t.get("ambiguity_basis")
    if basis=="no_prior_focus":
     assert idx==0,"no_prior_focus CLARIFY must be first turn"
    elif basis=="multi_referent_set":
     assert idx>0,"multi_referent_set requires prior turn"
     prev_turn=tr["turns"][idx-1]
     assert prev_turn["gold_decision"]=="EXECUTE"
     assert isinstance(prev_turn.get("gold_target"),list) and len(prev_turn["gold_target"])>=2
    else:
     raise AssertionError("CLARIFY missing provable ambiguity basis")
   if t.get("gold_target"):
    targets=t["gold_target"] if isinstance(t["gold_target"],list) else [t["gold_target"]]
    for x in targets:pairs[split].add((x["area"],x["entity"]))
   prev=t["gold_state"]

 assert turns==m["turns"]
 actual_split_counts={s:len(by_split[s]) for s in ("train","dev","sealed")}
 assert actual_split_counts==m["split_counts"],"manifest split_counts mismatch"
 assert abs(actual_split_counts["dev"]-actual_split_counts["sealed"])<=1
 for a1,b1 in (("train","dev"),("train","sealed"),("dev","sealed")):
  overlap=texts[a1]&texts[b1];assert not overlap,f"text leakage {a1}/{b1}: {list(overlap)[:5]}"
  assert not (templates[a1]&templates[b1]),f"surface template leakage {a1}/{b1}"
 for split in ("train","dev","sealed"):
  total=sum(text_freq[split].values())
  max_share=max(text_freq[split].values())/total
  assert max_share<=0.08,f"{split} single utterance dominates distribution: {max_share:.3f}"
 if release not in LEGACY_RELEASE_SHA256:
  assert naming_by_split["train"]["non_standard_alias"]==0
  assert naming_by_split["dev"]["non_standard_alias"]>0
  assert naming_by_split["sealed"]["non_standard_alias"]>0
  mentionable=sum(naming_by_split["sealed"][x] for x in ("canonical","non_standard_alias"))
  alias_share=naming_by_split["sealed"]["non_standard_alias"]/mentionable
  assert 0.15<=alias_share<=0.55,f"sealed alias coverage out of range: {alias_share}"
  for required in ("single_intent","multi_intent","omitted_attribute","underspecified_target"):
   assert shape[required]>0,f"instruction shape missing: {required}"
  assert dict(naming)==m.get("surface_naming_class_counts")
  assert dict(shape)==m.get("instruction_shape_counts")
 assert decision["EXECUTE"]>0 and decision["CLARIFY"]>0
 assert generalization["compositional_holdout"]>0 and generalization["seen_combo"]>0 and generalization["ambiguity_holdout"]>0
 sealed_exec=sealed_generalization["seen_combo"]+sealed_generalization["compositional_holdout"]
 assert sealed_exec>0
 assert sealed_generalization["compositional_holdout"]/sealed_exec>=0.35,"sealed split underweights compositional holdout"
 for name in ("direct_slot","direct_power","relative_coreference","explicit_correction","multi_target","ambiguous_clarify"):
  assert family[name]>=max(5,turns//100),f"scenario family under-covered: {name}"
 assert set(difficulty)>={1,3,4}
 train_pairs=pairs["train"]
 for split in ("dev","sealed"):
  assert pairs[split]-train_pairs,f"{split} lacks room×entity compositional holdout"
 # Vocabulary remains shared: hold out combinations, not entity identities.
 entities={s:{e for _,e in pairs[s]} for s in ("train","dev","sealed")}
 assert entities["train"]==entities["dev"]==entities["sealed"]=={"空调","灯","窗"}

 print(json.dumps({
  "valid":True,"trajectories":len(ts),"turns":turns,
  "release_id":m["release_id"],"generator_version":m["generator_version"],
  "semantic_profile":m.get("semantic_profile","legacy_v3_1"),"split_counts":actual_split_counts,
  "decisions":dict(decision),"families":dict(family),"difficulty":dict(difficulty),
  "generalization_classes":dict(generalization),"sealed_generalization_classes":dict(sealed_generalization),
  "surface_naming_classes":dict(naming),"instruction_shapes":dict(shape),
  "cross_split_text_overlap":0,"cross_split_template_overlap":0,
  "max_text_frequency_share":{s:max(text_freq[s].values())/sum(text_freq[s].values()) for s in ("train","dev","sealed")},
  "sealed_unseen_room_entity_pairs":sorted([list(x) for x in pairs["sealed"]-train_pairs]),
  "sha256_verified":True
 },ensure_ascii=False))

if __name__=="__main__":main()
