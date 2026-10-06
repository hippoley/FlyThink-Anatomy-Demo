#!/usr/bin/env python3
"""Paired V2 experiment: all-head baseline vs resolver contrast on identical real FlyWire."""
import argparse,json
from pathlib import Path
import torch
from layered_flywire import LayeredFlyWire
from layered_dataset import rows
from layered_training_data import pack,batch_targets
from responsibility_loss import joint_loss
from resolution_contrast_loss import contrastive_resolution_loss
REGIMES={"C_baseline":0.0,"E_resolution_contrast":0.25}
def accuracy(m,items):
 x,ys=pack(items)
 with torch.no_grad():o=m(x)
 ps={k:v.argmax(1) for k,v in o["semantic"].items()};pr={k:v.argmax(1) for k,v in o["resolution"].items() if k!="membership"};pj=o["judgement"].argmax(1);pm=o["resolution"]["membership"].sigmoid()>=.5
 sem=[];one=[];sett=[];jud=[]
 for i,y in enumerate(ys):
  sem.append(all(int(ps[k][i])==v for k,v in y["semantic"].items()))
  if y["resolution_one"]:one.append(all(int(pr[k][i])==y["resolution"][k] for k in ("room","entity","slot")))
  if y["resolution_set"]:sett.append(bool(torch.equal(pm[i].cpu(),torch.tensor(y["resolution"]["membership"],dtype=torch.bool))))
  jud.append(int(pj[i])==y["judgement"])
 return {"semantic":sum(sem)/len(sem),"resolution_one":sum(one)/len(one) if one else None,"resolution_one_n":len(one),"resolution_set":sum(sett)/len(sett) if sett else None,"resolution_set_n":len(sett),"judgement":sum(jud)/len(jud)}
def train(g,seed,contrast,epochs):
 torch.manual_seed(seed);m=LayeredFlyWire(g,seed);tr=rows("train","v2");x,ys=pack(tr);t=batch_targets(ys);opt=torch.optim.AdamW(m.parameters(),lr=.003,weight_decay=.01)
 for _ in range(epochs):
  opt.zero_grad();z=m.encode(x);o=m.classify(z)
  base,_=joint_loss(o,t,{"semantic":1,"resolution":1,"judgement":1},masks={"resolution_one":t["resolution_one_mask"],"resolution_set":t["resolution_set_mask"]})
  loss=base+contrast*contrastive_resolution_loss(z,ys);loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1);opt.step()
 return m
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",default="artifacts/flywire/connectome.json");ap.add_argument("--epochs",type=int,default=120);ap.add_argument("--out",default="artifacts/resolution-contrast-v2");a=ap.parse_args();g=json.loads(Path(a.graph).read_text())
 report={"truth":"v2_real_flywire_resolution_contrast_paired","contrast_weight":0.25,"regimes":{}}
 for name,w in REGIMES.items():
  report["regimes"][name]=[]
  for seed in (2783,3783,4783):
   m=train(g,seed,w,a.epochs);report["regimes"][name].append({"seed":seed,"train":accuracy(m,rows("train","v2")),"dev":accuracy(m,rows("dev","v2")),"test":accuracy(m,rows("test","v2"))})
 Path(a.out).mkdir(parents=True,exist_ok=True);Path(a.out,"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
if __name__=="__main__":main()
