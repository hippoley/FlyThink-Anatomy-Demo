#!/usr/bin/env python3
"""Long-trajectory benchmark V3.

Goals:
- objective whole-home state/write-set oracles;
- split-isolated surface forms;
- room×entity compositional holdouts with shared vocabulary;
- EXECUTE + CLARIFY coverage;
- explicit difficulty/family metadata;
- counterfactual target pairs;
- deterministic generation with a sealed split.
"""
import argparse,copy,hashlib,json,pathlib,random,re

BASE_SEED=20261009
LEGACY_RELEASE_SHA256={
 "2026-10":"e73f8ad72b0e2fe1d667f64c4a78e16ad9c867a8a23b8dd84578f18436b378a0",
}
ROOMS=["客厅","主卧","书房","次卧"]
DEVICES={
 "空调":{"model_id":"AWGD-ZA01","slots":{"power":"OFF","temperature":24}},
 "灯":{"model_id":"LIGHT_GROUP","slots":{"power":"OFF","brightness":50}},
 "窗":{"model_id":"CWDS-CA01","slots":{"power":"OFF","opening":0}},
}
SPLITS=("train","dev","sealed")
SPLIT_WEIGHTS=(.67,.165,.165)
PAIR_ALLOW={
 "train":{
   ("客厅","空调"),("主卧","空调"),("书房","灯"),("次卧","灯"),("客厅","窗"),("次卧","窗")
 },
 "dev":{
   ("书房","空调"),("次卧","空调"),("客厅","灯"),("主卧","灯"),("主卧","窗"),("书房","窗")
 },
 "sealed":{
   ("客厅","空调"),("书房","空调"),("主卧","灯"),("次卧","灯"),("客厅","窗"),("书房","窗")
 },
}
ENTITY_ALIASES={
 "train":{"空调":["空调"],"灯":["灯"],"窗":["窗"]},
 "dev":{"空调":["空调机","冷气机"],"灯":["灯光","照明灯"],"窗":["窗户","玻璃窗"]},
 "sealed":{"空调":["冷气","空调设备"],"灯":["照明","灯具"],"窗":["窗子","外窗"]},
}

TEMPLATES={
 "train":{
  "slot":["{r}{e}的{s}设成{v}","把{r}{e}{s}调到{v}"],
  "power_on":["打开{r}{e}","把{r}{e}开起来"],
  "power_off":["关闭{r}{e}","把{r}{e}关掉"],
  "relative":["再{word}一点","继续{word}一点","还是刚才那个，再{word}些","不用换目标，再{word}一点","接着往{word}的方向调","刚才那个继续{word}"],
  "clarify":["调低一点","打开一点","再调一下","弄小点","把那个改一下","稍微调一调"],
  "correction":["不是{wrong}，是{r}{e}，{s}设成{v}"],
  "multi":["{r}和{r2}的{e}{s}都调到{v}"],
 },
 "dev":{
  "slot":["我要{r}{e}{s}到{v}","将{r}{e}的{s}改为{v}"],
  "power_on":["开启{r}{e}","让{r}{e}开始工作"],
  "power_off":["停掉{r}{e}","让{r}{e}停止"],
  "relative":["在刚才基础上{word}一点","接着{word}一点","保持对象不变再{word}些","还是上一个，再{word}一点","沿用前项继续{word}","目标不变，往{word}调"],
  "clarify":["再调整下","弄小一点","改一下那个","稍微变化一点","把它调整下","再来一点"],
  "correction":["刚说错了，不要{wrong}，改成{r}{e}{s}{v}"],
  "multi":["同时把{r}、{r2}{e}的{s}设为{v}"],
 },
 "sealed":{
  "slot":["{r}{e}我想要{s}{v}","麻烦将{r}{e}{s}调整至{v}"],
  "power_on":["启动{r}{e}","给我开{r}{e}"],
  "power_off":["停用{r}{e}","把{r}{e}停了"],
  "relative":["沿用上个目标再{word}一些","还是它，再{word}一点","别换设备，继续{word}","刚才那个往{word}再走一点","维持目标再{word}些","上一个对象继续{word}"],
  "clarify":["那个再低一点","把它开一些","把刚才那个调下","再改变一点","稍微动一下它","那个再来一点"],
  "correction":["更正一下，目标不是{wrong}而是{r}{e}，{s}{v}"],
  "multi":["{r}跟{r2}这两处{e}，{s}统一到{v}"],
 },
}

def key(r,e): return f"{r}::{e}::default"
def target(r,e): return {"area":r,"entity":e,"instance":"default"}
def snapshot(state): return {k:copy.deepcopy(v["slots"]) for k,v in state.items()}
def state_template():
 return {key(r,e):{"model_id":d["model_id"],"slots":copy.deepcopy(d["slots"])}
         for r in ROOMS for e,d in DEVICES.items()}
def initial_runtime(state):
 return {"devices":{k:{"key":k,"area":k.split("::")[0],"entity":k.split("::")[1],
   "instance":"default","status":"mounted",**copy.deepcopy(v)} for k,v in state.items()}}

def slot_spec(e,rng):
 if e=="空调": return "温度","temperature",rng.randint(18,28),"低",-1
 if e=="灯": return "亮度","brightness",rng.choice([20,40,60,80]),"亮",10
 return "开度","opening",rng.choice([20,40,60,80]),"大",10

def choose_pair(split,rng,entity=None):
 xs=[p for p in sorted(PAIR_ALLOW[split]) if entity is None or p[1]==entity]
 return rng.choice(xs)

def render(split,family,rng,**kw):
 ts=TEMPLATES[split][family]
 idx=rng.randrange(len(ts))
 return ts[idx].format(**kw),f"{split}.{family}.{idx}"

def surface_entity(split,canonical,rng,profile):
 if profile=="legacy_v3_1" or split=="train":
  return canonical,"canonical"
 # New profiles intentionally hold out device naming variants by split.
 # Keep a canonical path so naming OOD is a slice, not the whole benchmark.
 if rng.random()<0.35:
  return rng.choice(ENTITY_ALIASES[split][canonical]),"non_standard_alias"
 return canonical,"canonical"

def annotate_robustness(turn,naming_class):
 turn["surface_naming_class"]=naming_class
 fam=turn["scenario_family"]
 if fam=="multi_target":turn["instruction_shape"]="multi_intent"
 elif fam=="relative_coreference":turn["instruction_shape"]="omitted_attribute"
 elif fam=="ambiguous_clarify":turn["instruction_shape"]="underspecified_target"
 else:turn["instruction_shape"]="single_intent"
 return turn

def changed_paths(before,after):
 out=[]
 for k in sorted(before):
  for slot in sorted(set(before[k]["slots"])|set(after[k]["slots"])):
   if before[k]["slots"].get(slot)!=after[k]["slots"].get(slot):
    out.append(f"devices.{k}.slots.{slot}")
 return out

def semantic_profile(release_id):
 return "legacy_v3_1" if release_id in LEGACY_RELEASE_SHA256 else "existing_device_power_v3_2"

def make_execute_turn(split,state,rng,focus,family,profile):
 before=copy.deepcopy(state)
 if family=="multi":
  e=rng.choice(["空调","灯","窗"])
  pairs=[p for p in sorted(PAIR_ALLOW[split]) if p[1]==e]
  if len(pairs)<2: family="slot"
  else:
   (r,_),(r2,_)=rng.sample(pairs,2)
   sname,slot,v,word,delta=slot_spec(e,rng)
   se,naming=surface_entity(split,e,rng,profile)
   text,tid=render(split,"multi",rng,r=r,r2=r2,e=se,s=sname,v=v,word=word,wrong="")
   targets=[target(r,e),target(r2,e)]
   for rr in (r,r2): state[key(rr,e)]["slots"][slot]=v
   turn={
    "text":text,"surface_template_id":tid,"scenario_family":"multi_target",
    "difficulty":4,"context_hint":{},"gold_decision":"EXECUTE","gold_op":"PATCH_SLOT",
    "gold_target":targets,"gold_slot":slot,"gold_value":v,
    "gold_write_set":changed_paths(before,state),"gold_state":snapshot(state)
   }
   return annotate_robustness(turn,naming),(r2,e)

 r,e=choose_pair(split,rng)
 sname,slot,v,word,delta=slot_spec(e,rng)
 t=target(r,e)
 se,naming=surface_entity(split,e,rng,profile)
 if family=="power":
  on=rng.random()<.5
  fname="power_on" if on else "power_off"
  text,tid=render(split,fname,rng,r=r,e=se,s=sname,v=v,word=word,wrong="")
  op="ADD_DEVICE" if (on and profile=="legacy_v3_1") else ("PATCH_SLOT" if on else "CLOSE_DEVICE")
  state[key(r,e)]["slots"]["power"]="ON" if on else "OFF"
  turn={"text":text,"surface_template_id":tid,"scenario_family":"direct_power","difficulty":1,
    "context_hint":{"focused_target":t},"gold_decision":"EXECUTE","gold_op":op,"gold_target":t}
  if on and profile=="legacy_v3_1":
   turn["gold_slots"]={"power":"ON"}
  elif on:
   turn["gold_slot"]="power";turn["gold_value"]="ON"
 elif family=="relative" and focus is not None:
  r,e=focus;t=target(r,e)
  if e=="窗": slot="opening";word="大";delta=10
  elif e=="空调": slot="temperature";word="低";delta=-1
  else: slot="brightness";word="亮";delta=10
  text,tid=render(split,"relative",rng,r=r,e=e,s=slot,v="",word=word,wrong="")
  naming="not_mentioned"
  state[key(r,e)]["slots"][slot]+=delta
  turn={"text":text,"surface_template_id":tid,"scenario_family":"relative_coreference","difficulty":3,
    "context_hint":{"focused_target":t},"gold_decision":"EXECUTE","gold_op":"PATCH_RELATIVE",
    "gold_target":t,"gold_slot":slot,"gold_delta":delta}
 elif family=="correction":
  wrong=rng.choice([x for x in ROOMS if x!=r])
  text,tid=render(split,"correction",rng,r=r,e=se,s=sname,v=v,word=word,wrong=wrong)
  state[key(r,e)]["slots"][slot]=v
  turn={"text":text,"surface_template_id":tid,"scenario_family":"explicit_correction","difficulty":3,
    "context_hint":{"focused_target":target(wrong,e)},"gold_decision":"EXECUTE","gold_op":"PATCH_SLOT",
    "gold_target":t,"gold_slot":slot,"gold_value":v,
    "counterfactual_from":target(wrong,e)}
 else:
  text,tid=render(split,"slot",rng,r=r,e=se,s=sname,v=v,word=word,wrong="")
  state[key(r,e)]["slots"][slot]=v
  turn={"text":text,"surface_template_id":tid,"scenario_family":"direct_slot","difficulty":1,
    "context_hint":{"focused_target":t},"gold_decision":"EXECUTE","gold_op":"PATCH_SLOT",
    "gold_target":t,"gold_slot":slot,"gold_value":v}
 turn["gold_write_set"]=changed_paths(before,state)
 turn["gold_state"]=snapshot(state)
 return annotate_robustness(turn,naming),(r,e)

def make_clarify(split,state,rng,focus,basis):
 if basis not in ("no_prior_focus","multi_referent_set"):
  raise ValueError("clarify requires explicit ambiguity basis")
 e=rng.choice(["空调","灯","窗"])
 sname,slot,v,word,delta=slot_spec(e,rng)
 text,tid=render(split,"clarify",rng,r="",e=e,s=sname,v=v,word=word,wrong="")
 turn={
  "text":text,"surface_template_id":tid,"scenario_family":"ambiguous_clarify",
  "difficulty":4,"context_hint":{},"gold_decision":"CLARIFY",
  "ambiguity_basis":basis,
  "gold_write_set":[],"gold_state":snapshot(state)
 }
 return annotate_robustness(turn,"not_applicable"),focus

def assert_template_isolation():
 for i,a in enumerate(SPLITS):
  sa={x for xs in TEMPLATES[a].values() for x in xs}
  for b in SPLITS[i+1:]:
   sb={x for xs in TEMPLATES[b].values() for x in xs}
   overlap=sa&sb
   if overlap: raise ValueError(f"surface_template_overlap:{a}:{b}:{sorted(overlap)}")

def split_for(i,count):
 train_n=(count*2)//3
 remaining=count-train_n
 dev_n=remaining//2
 if i<train_n:return "train"
 if i<train_n+dev_n:return "dev"
 return "sealed"

def release_seed(release_id):
 raw=f"{BASE_SEED}:{release_id}".encode()
 return int.from_bytes(hashlib.sha256(raw).digest()[:8],"big")

def generalization_class(turn):
 if turn["gold_decision"]!="EXECUTE": return "ambiguity_holdout"
 targets=turn.get("gold_target")
 if not targets:return "other"
 if not isinstance(targets,list):targets=[targets]
 pairs={(t["area"],t["entity"]) for t in targets}
 return "compositional_holdout" if any(p not in PAIR_ALLOW["train"] for p in pairs) else "seen_combo"

def make(i,count,rng,profile):
 split=split_for(i,count)
 state=state_template();initial=initial_runtime(state);turns=[];focus=None
 n=rng.randint(12,28)
 families=["slot","power","relative","correction","multi"]
 weights=[.31,.17,.22,.16,.14]
 j=0
 # A first-turn ambiguous request is valid because no conversational focus exists.
 if rng.random()<.25:
  turn,focus=make_clarify(split,state,rng,focus,"no_prior_focus")
  turn["turn_id"]=f"{split}-{i:03d}-{j:02d}";j+=1
  turn["generalization_class"]=generalization_class(turn);turns.append(turn)
 while j<n:
  fam=rng.choices(families,weights=weights,k=1)[0]
  turn,focus=make_execute_turn(split,state,rng,focus,fam,profile)
  turn["turn_id"]=f"{split}-{i:03d}-{j:02d}";j+=1
  turn["generalization_class"]=generalization_class(turn);turns.append(turn)
  # Under the gold history, a multi-target patch leaves no unique focused_target:
  # runtime_context_adapter exposes the whole targets array as referent_set.
  # A singular deictic follow-up is therefore genuinely ambiguous.
  if fam=="multi" and j<n and rng.random()<.65:
   turn,focus=make_clarify(split,state,rng,focus,"multi_referent_set")
   turn["turn_id"]=f"{split}-{i:03d}-{j:02d}";j+=1
   turn["generalization_class"]=generalization_class(turn);turns.append(turn)
 return {"id":f"whole-home-v3-{i:03d}","split":split,"initial_runtime":initial,"turns":turns}

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--count",type=int,default=180)
 ap.add_argument("--out",default="benchmarks/long_trajectories_v3.json")
 ap.add_argument("--release-id",default="2026-10")
 a=ap.parse_args()
 if a.count<60: raise SystemExit("count must be >=60")
 if not re.fullmatch(r"[0-9]{4}-[0-9]{2}(?:-r[1-9][0-9]*)?",a.release_id):
  raise SystemExit("release-id must be YYYY-MM or YYYY-MM-rN")
 assert_template_isolation()
 profile=semantic_profile(a.release_id)
 seed=release_seed(a.release_id)
 rng=random.Random(seed)
 rows=[make(i,a.count,rng,profile) for i in range(a.count)]
 raw=json.dumps(rows,ensure_ascii=False,separators=(",",":"),sort_keys=True).encode()
 split_counts={s:sum(x["split"]==s for x in rows) for s in SPLITS}
 family_counts={};generalization_counts={};naming_counts={};shape_counts={}
 for tr in rows:
  for t in tr["turns"]:
   family_counts[t["scenario_family"]]=family_counts.get(t["scenario_family"],0)+1
   generalization_counts[t["generalization_class"]]=generalization_counts.get(t["generalization_class"],0)+1
   if "surface_naming_class" in t:naming_counts[t["surface_naming_class"]]=naming_counts.get(t["surface_naming_class"],0)+1
   if "instruction_shape" in t:shape_counts[t["instruction_shape"]]=shape_counts.get(t["instruction_shape"],0)+1
 manifest={
  "truth":"whole_home_long_trajectory_generalization_v3",
  "generator_version":"long-trajectory-v3.1" if profile=="legacy_v3_1" else "long-trajectory-v3.2",
  "release_id":a.release_id,
  "seed":seed,"base_seed":BASE_SEED,"trajectories":len(rows),"turns":sum(len(x["turns"]) for x in rows),
  "split_counts":split_counts,"scenario_family_counts":family_counts,
  "generalization_class_counts":generalization_counts,
  "devices_per_home":len(ROOMS)*len(DEVICES),"rooms":ROOMS,"device_types":list(DEVICES),
  "sealed_surface_templates_disjoint":True,
  "sha256":hashlib.sha256(raw).hexdigest()
 }
 if profile!="legacy_v3_1":
  manifest["semantic_profile"]=profile
  manifest["surface_naming_class_counts"]=naming_counts
  manifest["instruction_shape_counts"]=shape_counts
 if a.release_id in LEGACY_RELEASE_SHA256 and manifest["sha256"]!=LEGACY_RELEASE_SHA256[a.release_id]:
  raise RuntimeError("legacy_release_sha_drift:"+a.release_id+":"+manifest["sha256"])
 p=pathlib.Path(a.out);p.parent.mkdir(parents=True,exist_ok=True)
 p.write_text(json.dumps({"manifest":manifest,"trajectories":rows},ensure_ascii=False,indent=2)+"\n")
 print(json.dumps(manifest,ensure_ascii=False))

if __name__=="__main__":main()
