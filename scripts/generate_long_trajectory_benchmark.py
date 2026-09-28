#!/usr/bin/env python3
"""Generate a reproducible long-horizon whole-home trajectory benchmark."""
import json,random,hashlib,argparse
SEED=20260928
ROOMS=["客厅","主卧","书房","次卧"]
OPEN=["打开{r}空调","把{r}空调开启","{r}空调开起来"]
CLOSE=["关闭{r}空调","把{r}空调关掉","停掉{r}空调"]
TEMP=["{r}空调温度调到{v}度","把{r}温度设成{v}度","{r}空调设到{v}度"]
REL=["再低一点","温度再降一点"]
def target(r):return {"area":r,"entity":"空调","instance":"default"}
def make(i,rng):
 n=rng.randint(10,30); room=rng.choice(ROOMS); turns=[]; state={x:{"power":"OFF","temperature":24} for x in ROOMS}
 for k in range(n):
  if k==0 or rng.random()<.28: room=rng.choice(ROOMS)
  t=target(room); typ=rng.choices(["open","close","temp","relative"],[.25,.2,.35,.2])[0]
  if typ=="open":
   text=rng.choice(OPEN).format(r=room);op="ADD_DEVICE";extra={"gold_slots":{"power":"ON"}};state[room]["power"]="ON"
  elif typ=="close":
   text=rng.choice(CLOSE).format(r=room);op="CLOSE_DEVICE";extra={};state[room]["power"]="OFF"
  elif typ=="temp":
   v=rng.randint(18,28);text=rng.choice(TEMP).format(r=room,v=v);op="PATCH_SLOT";extra={"gold_slot":"temperature","gold_value":v};state[room]["temperature"]=v
  else:
   text=rng.choice(REL);op="PATCH_RELATIVE";extra={"gold_slot":"temperature","gold_delta":-1};state[room]["temperature"]-=1
  turns.append({"text":text,"context_hint":{"focused_target":t},"gold_decision":"EXECUTE","gold_op":op,"gold_target":t,**extra,"gold_state":{f"{room}::空调::default":dict(state[room])}})
 return {"id":f"long-{i:03d}","turns":turns}
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--count",type=int,default=120);ap.add_argument("--out",default="benchmarks/long_trajectories_v1.json");a=ap.parse_args()
 rng=random.Random(SEED);rows=[make(i,rng) for i in range(a.count)]
 raw=json.dumps(rows,ensure_ascii=False,separators=(",",":")).encode();manifest={"truth":"frozen_long_horizon_whole_home_v1","seed":SEED,"trajectories":len(rows),"turns":sum(len(x["turns"]) for x in rows),"min_turns":min(len(x["turns"]) for x in rows),"max_turns":max(len(x["turns"]) for x in rows),"sha256":hashlib.sha256(raw).hexdigest()}
 import pathlib;p=pathlib.Path(a.out);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps({"manifest":manifest,"trajectories":rows},ensure_ascii=False,indent=2));print(json.dumps(manifest,ensure_ascii=False))
if __name__=="__main__":main()
