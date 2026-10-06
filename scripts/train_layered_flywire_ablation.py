#!/usr/bin/env python3
"""A/B/C supervision ablation on one real FlyWire graph and paired seeds."""
import argparse,json
from pathlib import Path
import torch
from layered_flywire import LayeredFlyWire
from layered_dataset import rows
from layered_training_data import pack,batch_targets
from responsibility_loss import joint_loss
REGIMES={"A_semantic":{"semantic":1.0,"resolution":0.0,"judgement":0.0},
"B_semantic_resolution":{"semantic":1.0,"resolution":1.0,"judgement":0.0},
"C_all_heads":{"semantic":1.0,"resolution":1.0,"judgement":1.0}}
def accuracy(m,items):
 x,ys=pack(items)
 with torch.no_grad():o=m(x)
 pred_sem={k:v.argmax(1) for k,v in o["semantic"].items()};pred_res={k:v.argmax(1) for k,v in o["resolution"].items()};pred_j=o["judgement"].argmax(1)
 sem=[];res=[];jud=[]
 for i,y in enumerate(ys):
  sem.append(all(int(pred_sem[k][i])==v for k,v in y["semantic"].items()))
  gold_exec=items[i]["labels"]["judgement"]=="EXECUTE"
  if gold_exec:res.append(all(int(pred_res[k][i])==v for k,v in y["resolution"].items()))
  jud.append(int(pred_j[i])==y["judgement"])
 return {"semantic":sum(sem)/len(sem),"resolution":sum(res)/len(res) if res else None,"resolution_n":len(res),"judgement":sum(jud)/len(jud)}
def train(g,regime,seed,epochs):
 torch.manual_seed(seed);m=LayeredFlyWire(g,seed);tr=rows("train");x,ys=pack(tr);t=batch_targets(ys);opt=torch.optim.AdamW(m.parameters(),lr=.003,weight_decay=.01)
 for _ in range(epochs):
  opt.zero_grad();o=m(x);exec_mask=t["judgement"]==0;loss,_=joint_loss(o,t,REGIMES[regime],masks={"resolution":exec_mask});loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1);opt.step()
 return m
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",default="artifacts/flywire/connectome.json");ap.add_argument("--epochs",type=int,default=120);ap.add_argument("--out",default="artifacts/layered-ablation");a=ap.parse_args()
 g=json.loads(Path(a.graph).read_text());report={"truth":"layered_flywire_abc_paired_seed_v1","regimes":{}}
 for regime in REGIMES:
  report["regimes"][regime]=[]
  for seed in (2783,3783,4783):
   m=train(g,regime,seed,a.epochs);report["regimes"][regime].append({"seed":seed,"train":accuracy(m,rows("train")),"dev":accuracy(m,rows("dev")),"test":accuracy(m,rows("test"))})
 Path(a.out).mkdir(parents=True,exist_ok=True);Path(a.out,"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
if __name__=="__main__":main()
