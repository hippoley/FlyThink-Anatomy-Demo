#!/usr/bin/env python3
import argparse,collections,hashlib,json,re

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
 assert m.get("generator_version")=="long-trajectory-v3.1"
 assert re.fullmatch(r"[0-9]{4}-[0-9]{2}",m.get("release_id",""))
 assert len(ts)>=60 and set(x["split"] for x in ts)=={"train","dev","sealed"}
 raw=json.dumps(ts,ensure_ascii=False,separators=(",",":"),sort_keys=True).encode()
 assert hashlib.sha256(raw).hexdigest()==m["sha256"],"manifest sha256 does not bind trajectories"

 by_split=collections.defaultdict(list);texts=collections.defaultdict(set);text_freq=collections.defaultdict(collections.Counter);templates=collections.defaultdict(set)
 family=collections.Counter();decision=collections.Counter();difficulty=collections.Counter();generalization=collections.Counter();sealed_generalization=collections.Counter()
 pairs=collections.defaultdict(set);turns=0
 for tr in ts:
  split=tr["split"];by_split[split].append(tr)
  expected=set(tr["initial_runtime"]["devices"])
  assert len(expected)==m["devices_per_home"]
  prev={k:v["slots"] for k,v in tr["initial_runtime"]["devices"].items()}
  for t in tr["turns"]:
   turns+=1;family[t["scenario_family"]]+=1;decision[t["gold_decision"]]+=1;difficulty[t["difficulty"]]+=1
   generalization[t["generalization_class"]]+=1
   if split=="sealed":sealed_generalization[t["generalization_class"]]+=1
   nt=norm_text(t["text"]);texts[split].add(nt);text_freq[split][nt]+=1
   templates[split].add(t["surface_template_id"])
   assert set(t["gold_state"])==expected
   observed=diff_state(prev,t["gold_state"])
   assert sorted(observed)==sorted(t["gold_write_set"]),(t["turn_id"],observed,t["gold_write_set"])
   if t["gold_decision"]!="EXECUTE":
    assert not observed and not t["gold_write_set"],"non-execute turn mutated state"
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
  "release_id":m["release_id"],"split_counts":actual_split_counts,
  "decisions":dict(decision),"families":dict(family),"difficulty":dict(difficulty),
  "generalization_classes":dict(generalization),"sealed_generalization_classes":dict(sealed_generalization),
  "cross_split_text_overlap":0,"cross_split_template_overlap":0,
  "max_text_frequency_share":{s:max(text_freq[s].values())/sum(text_freq[s].values()) for s in ("train","dev","sealed")},
  "sealed_unseen_room_entity_pairs":sorted([list(x) for x in pairs["sealed"]-train_pairs]),
  "sha256_verified":True
 },ensure_ascii=False))

if __name__=="__main__":main()
