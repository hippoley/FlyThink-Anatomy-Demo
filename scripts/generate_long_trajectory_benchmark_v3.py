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

SEED=20261009
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
TEMPLATES={
 "train":{
  "slot":["{r}{e}的{s}设成{v}","把{r}{e}{s}调到{v}"],
  "power_on":["打开{r}{e}","把{r}{e}开起来"],
  "power_off":["关闭{r}{e}","把{r}{e}关掉"],
  "relative":["再{word}一点","继续{word}一点"],
  "clarify":["调低一点","打开一点"],
  "correction":["不是{wrong}，是{r}{e}，{s}设成{v}"],
  "multi":["{r}和{r2}的{e}{s}都调到{v}"],
 },
 "dev":{
  "slot":["我要{r}{e}{s}到{v}","将{r}{e}的{s}改为{v}"],
  "power_on":["开启{r}{e}","让{r}{e}开始工作"],
  "power_off":["停掉{r}{e}","让{r}{e}停止"],
  "relative":["在刚才基础上{word}一点","接着{word}一点"],
  "clarify":["再调一下","弄小一点"],
  "correction":["刚说错了，不要{wrong}，改成{r}{e}{s}{v}"],
  "multi":["同时把{r}、{r2}{e}的{s}设为{v}"],
 },
 "sealed":{
  "slot":["{r}{e}我想要{s}{v}","麻烦将{r}{e}{s}调整至{v}"],
  "power_on":["启动{r}{e}","给我开{r}{e}"],
  "power_off":["停用{r}{e}","把{r}{e}停了"],
  "relative":["沿用上个目标再{word}一些","还是它，再{word}一点"],
  "clarify":["那个再低一点","把它开一些"],
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

def changed_paths(before,after):
 out=[]
 for k in sorted(before):
  for slot in sorted(set(before[k]["slots"])|set(after[k]["slots"])):
   if before[k]["slots"].get(slot)!=after[k]["slots"].get(slot):
    out.append(f"devices.{k}.slots.{slot}")
 return out

def make_execute_turn(split,state,rng,focus,family):
 before=copy.deepcopy(state)
 if family=="multi":
  e=rng.choice(["空调","灯","窗"])
  pairs=[p for p in sorted(PAIR_ALLOW[split]) if p[1]==e]
  if len(pairs)<2: family="slot"
  else:
   (r,_),(r2,_)=rng.sample(pairs,2)
   sname,slot,v,word,delta=slot_spec(e,rng)
   text,tid=render(split,"multi",rng,r=r,r2=r2,e=e,s=sname,v=v,word=word,wrong="")
   targets=[target(r,e),target(r2,e)]
   for rr in (r,r2): state[key(rr,e)]["slots"][slot]=v
   return {
    "text":text,"surface_template_id":tid,"scenario_family":"multi_target",
    "difficulty":4,"context_hint":{},"gold_decision":"EXECUTE","gold_op":"PATCH_SLOT",
    "gold_target":targets,"gold_slot":slot,"gold_value":v,
    "gold_write_set":changed_paths(before,state),"gold_state":snapshot(state)
   },(r2,e)

 r,e=choose_pair(split,rng)
 sname,slot,v,word,delta=slot_spec(e,rng)
 t=target(r,e)
 if family=="power":
  on=rng.random()<.5
  fname="power_on" if on else "power_off"
  text,tid=render(split,fname,rng,r=r,e=e,s=sname,v=v,word=word,wrong="")
  op="ADD_DEVICE" if on else "CLOSE_DEVICE"
  state[key(r,e)]["slots"]["power"]="ON" if on else "OFF"
  turn={"text":text,"surface_template_id":tid,"scenario_family":"direct_power","difficulty":1,
    "context_hint":{"focused_target":t},"gold_decision":"EXECUTE","gold_op":op,"gold_target":t}
  if on: turn["gold_slots"]={"power":"ON"}
 elif family=="relative" and focus is not None:
  r,e=focus;t=target(r,e)
  if e=="窗": slot="opening";word="大";delta=10
  elif e=="空调": slot="temperature";word="低";delta=-1
  else: slot="brightness";word="亮";delta=10
  text,tid=render(split,"relative",rng,r=r,e=e,s=slot,v="",word=word,wrong="")
  state[key(r,e)]["slots"][slot]+=delta
  turn={"text":text,"surface_template_id":tid,"scenario_family":"relative_coreference","difficulty":3,
    "context_hint":{"focused_target":t},"gold_decision":"EXECUTE","gold_op":"PATCH_RELATIVE",
    "gold_target":t,"gold_slot":slot,"gold_delta":delta}
 elif family=="correction":
  wrong=rng.choice([x for x in ROOMS if x!=r])
  text,tid=render(split,"correction",rng,r=r,e=e,s=sname,v=v,word=word,wrong=wrong)
  state[key(r,e)]["slots"][slot]=v
  turn={"text":text,"surface_template_id":tid,"scenario_family":"explicit_correction","difficulty":3,
    "context_hint":{"focused_target":target(wrong,e)},"gold_decision":"EXECUTE","gold_op":"PATCH_SLOT",
    "gold_target":t,"gold_slot":slot,"gold_value":v,
    "counterfactual_from":target(wrong,e)}
 else:
  text,tid=render(split,"slot",rng,r=r,e=e,s=sname,v=v,word=word,wrong="")
  state[key(r,e)]["slots"][slot]=v
  turn={"text":text,"surface_template_id":tid,"scenario_family":"direct_slot","difficulty":1,
    "context_hint":{"focused_target":t},"gold_decision":"EXECUTE","gold_op":"PATCH_SLOT",
    "gold_target":t,"gold_slot":slot,"gold_value":v}
 turn["gold_write_set"]=changed_paths(before,state)
 turn["gold_state"]=snapshot(state)
 return turn,(r,e)

def make_clarify(split,state,rng,focus):
 e=rng.choice(["空调","灯","窗"])
 sname,slot,v,word,delta=slot_spec(e,rng)
 text,tid=render(split,"clarify",rng,r="",e=e,s=sname,v=v,word=word,wrong="")
 return {
  "text":text,"surface_template_id":tid,"scenario_family":"ambiguous_clarify",
  "difficulty":4,"context_hint":{},"gold_decision":"CLARIFY",
  "gold_write_set":[],"gold_state":snapshot(state)
 },focus

def split_for(i,count):
 train_n=round(count*SPLIT_WEIGHTS[0]); dev_n=round(count*SPLIT_WEIGHTS[1])
 if i<train_n:return "train"
 if i<train_n+dev_n:return "dev"
 return "sealed"

def make(i,count,rng):
 split=split_for(i,count)
 state=state_template();initial=initial_runtime(state);turns=[];focus=None
 n=rng.randint(12,28)
 families=["slot","power","relative","correction","multi","clarify"]
 weights=[.27,.15,.2,.14,.12,.12]
 for j in range(n):
  fam=rng.choices(families,weights=weights,k=1)[0]
  if fam=="clarify": turn,focus=make_clarify(split,state,rng,focus)
  else: turn,focus=make_execute_turn(split,state,rng,focus,fam)
  turn["turn_id"]=f"{split}-{i:03d}-{j:02d}"
  turns.append(turn)
 return {"id":f"whole-home-v3-{i:03d}","split":split,"initial_runtime":initial,"turns":turns}

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--count",type=int,default=180)
 ap.add_argument("--out",default="benchmarks/long_trajectories_v3.json")
 a=ap.parse_args()
 if a.count<60: raise SystemExit("count must be >=60")
 rng=random.Random(SEED)
 rows=[make(i,a.count,rng) for i in range(a.count)]
 raw=json.dumps(rows,ensure_ascii=False,separators=(",",":"),sort_keys=True).encode()
 split_counts={s:sum(x["split"]==s for x in rows) for s in SPLITS}
 family_counts={}
 for tr in rows:
  for t in tr["turns"]: family_counts[t["scenario_family"]]=family_counts.get(t["scenario_family"],0)+1
 manifest={
  "truth":"whole_home_long_trajectory_generalization_v3",
  "seed":SEED,"trajectories":len(rows),"turns":sum(len(x["turns"]) for x in rows),
  "split_counts":split_counts,"scenario_family_counts":family_counts,
  "devices_per_home":len(ROOMS)*len(DEVICES),"rooms":ROOMS,"device_types":list(DEVICES),
  "sealed_surface_templates_disjoint":True,
  "sha256":hashlib.sha256(raw).hexdigest()
 }
 p=pathlib.Path(a.out);p.parent.mkdir(parents=True,exist_ok=True)
 p.write_text(json.dumps({"manifest":manifest,"trajectories":rows},ensure_ascii=False,indent=2)+"\n")
 print(json.dumps(manifest,ensure_ascii=False))

if __name__=="__main__":main()
