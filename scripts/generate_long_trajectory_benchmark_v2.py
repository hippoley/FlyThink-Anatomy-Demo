#!/usr/bin/env python3
"""Frozen V2: multi-device long trajectories with whole-home state and exact write-set oracles."""
import json,random,hashlib,argparse,copy,pathlib
SEED=20260928
ROOMS=["客厅","主卧","书房","次卧"]
DEVICES={"空调":{"model_id":"AWGD-ZA01","slots":{"power":"OFF","temperature":24}},"灯":{"model_id":"LIGHT_GROUP","slots":{"power":"OFF","brightness":50}},"窗":{"model_id":"CWDS-CA01","slots":{"power":"OFF","opening":0}}}
def key(r,e):return f"{r}::{e}::default"
def target(r,e):return {"area":r,"entity":e,"instance":"default"}
def snapshot(state):return {k:copy.deepcopy(v["slots"]) for k,v in state.items()}
def make(i,rng):
 state={key(r,e):{"model_id":d["model_id"],"slots":copy.deepcopy(d["slots"])} for r in ROOMS for e,d in DEVICES.items()}
 initial={"devices":{k:{"key":k,"area":k.split("::")[0],"entity":k.split("::")[1],"instance":"default","status":"mounted",**copy.deepcopy(v)} for k,v in state.items()}}
 turns=[];focus=None
 for n in range(rng.randint(10,30)):
  r=rng.choice(ROOMS) if focus is None or rng.random()<.35 else focus[0];e=rng.choice(list(DEVICES)) if focus is None or rng.random()<.25 else focus[1]
  focus=(r,e);t=target(r,e);k=key(r,e);slot=None
  typ=rng.choice(["open","close","slot","relative"] if e!="窗" else ["open","close","slot"])
  if typ=="open":
   text=f"打开{r}{e}";op="ADD_DEVICE";state[k]["slots"]["power"]="ON";extra={"gold_slots":{"power":"ON"}};writes=[f"devices.{k}.slots.power"]
  elif typ=="close":
   text=f"把{r}{e}关掉";op="CLOSE_DEVICE";state[k]["slots"]["power"]="OFF";extra={};writes=[f"devices.{k}.slots.power"]
  elif typ=="slot":
   if e=="空调":slot="temperature";v=rng.randint(18,28);text=f"{r}空调温度调到{v}度"
   elif e=="灯":slot="brightness";v=rng.choice([20,40,60,80]);text=f"{r}灯亮度调到{v}%"
   else:slot="opening";v=rng.choice([20,40,60,80]);text=f"{r}窗户开到{v}%"
   op="PATCH_SLOT";state[k]["slots"][slot]=v;extra={"gold_slot":slot,"gold_value":v};writes=[f"devices.{k}.slots.{slot}"]
  else:
   slot="temperature" if e=="空调" else "brightness";delta=-1 if e=="空调" else 10;text="再低一点" if e=="空调" else "再亮一点";op="PATCH_RELATIVE";state[k]["slots"][slot]+=delta;extra={"gold_slot":slot,"gold_delta":delta};writes=[f"devices.{k}.slots.{slot}"]
  turns.append({"text":text,"context_hint":{"focused_target":t},"gold_decision":"EXECUTE","gold_op":op,"gold_target":t,**extra,"gold_write_set":writes,"gold_state":snapshot(state)})
 return {"id":f"whole-home-{i:03d}","initial_runtime":initial,"turns":turns}
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--count",type=int,default=120);ap.add_argument("--out",default="benchmarks/long_trajectories_v2.json");a=ap.parse_args();rng=random.Random(SEED);rows=[make(i,rng) for i in range(a.count)]
 raw=json.dumps(rows,ensure_ascii=False,separators=(",",":")).encode();m={"truth":"frozen_multi_device_whole_home_no_drift_v2","seed":SEED,"trajectories":len(rows),"turns":sum(len(x["turns"]) for x in rows),"devices_per_home":len(ROOMS)*len(DEVICES),"device_types":list(DEVICES),"min_turns":min(map(lambda x:len(x["turns"]),rows)),"max_turns":max(map(lambda x:len(x["turns"]),rows)),"sha256":hashlib.sha256(raw).hexdigest()}
 p=pathlib.Path(a.out);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps({"manifest":m,"trajectories":rows},ensure_ascii=False,indent=2));print(json.dumps(m,ensure_ascii=False))
if __name__=="__main__":main()
