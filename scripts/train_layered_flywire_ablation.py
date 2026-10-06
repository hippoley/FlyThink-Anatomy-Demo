#!/usr/bin/env python3
"""Paired-seed layered supervision ablation on verified real FlyWire."""
import argparse,json
from pathlib import Path
import torch
from layered_flywire import LayeredFlyWire
from layered_dataset import rows
from layered_training_data import pack,batch_targets
from responsibility_loss import joint_loss
REGIMES={"A_semantic":{"semantic":1.0,"resolution":0.0,"judgement":0.0},"B_semantic_resolution":{"semantic":1.0,"resolution":1.0,"judgement":0.0},"C_all_heads":{"semantic":1.0,"resolution":1.0,"judgement":1.0}}
def accuracy(m,items):
 x,ys=pack(items)
 with torch.no_grad():o=m(x)
 ps={k:v.argmax(1) for k,v in o["semantic"].items()};pr={k:v.argmax(1) for k,v in o["resolution"].items() if k!="membership"};pj=o["judgement"].argmax(1);pm=(o["resolution"]["membership"].sigmoid()>=.5)
 sem=[];one=[];sett=[];jud=[]
 for i,y in enumerate(ys):
  sem.append(all(int(ps[k][i])==v for k,v in y["semantic"].items()))
  if y["resolution_one"]:one.append(all(int(pr[k][i])==y["resolution"][k] for k in ("room","entity","slot")))
  if y["resolution_set"]:
   gold=torch.tensor(y["resolution"]["membership"],dtype=torch.bool);sett.append(bool(torch.equal(pm[i].cpu(),gold)))
  jud.append(int(pj[i])==y["judgement"])
 return {"semantic":sum(sem)/len(sem),"resolution_one":sum(one)/len(one) if one else None,"resolution_one_n":len(one),"resolution_set":sum(sett)/len(sett) if sett else None,"resolution_set_n":len(sett),"judgement":sum(jud)/len(jud)}
def train(g,regime,seed,epochs):
 torch.manual_seed(seed);m=LayeredFlyWire(g,seed);tr=rows("train");x,ys=pack(tr);t=batch_targets(ys);opt=torch.optim.AdamW(m.parameters(),lr=.003,weight_decay=.01)
 for _ in range(epochs):
  opt.zero_grad();o=m(x);loss,_=joint_loss(o,t,REGIMES[regime],masks={"resolution_one":t["resolution_one_mask"],"resolution_set":t["resolution_set_mask"]});loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1);opt.step()
 return m
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",default="artifacts/flywire/connectome.json");ap.add_argument("--epochs",type=int,default=120);ap.add_argument("--out",default="artifacts/layered-ablation");a=ap.parse_args();g=json.loads(Path(a.graph).read_text())
 report={"truth":"layered_flywire_abc_paired_seed_v3_one_set_resolution","regimes":{}}
 for regime in REGIMES:
  report["regimes"][regime]=[]
  for seed in (2783,3783,4783):
   m=train(g,regime,seed,a.epochs);report["regimes"][regime].append({"seed":seed,"train":accuracy(m,rows("train")),"dev":accuracy(m,rows("dev")),"test":accuracy(m,rows("test"))})
 Path(a.out).mkdir(parents=True,exist_ok=True);Path(a.out,"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
if __name__=="__main__":main()
