#!/usr/bin/env python3
"""Paired resolver A/B for V3/V4 with threshold-free room ranking diagnostics."""
import argparse,json,torch
from pathlib import Path
from flywire_encoder import FlyWireEncoder
from responsibility_heads import ResponsibilityHeads
from flat_responsibility_heads import FlatResponsibilityHeads
from layered_dataset import rows
from layered_training_data import pack,batch_targets
from responsibility_loss import joint_loss

class Model(torch.nn.Module):
 def __init__(self,g,seed,flat):
  super().__init__();self.encoder=FlyWireEncoder(g,seed);d=self.encoder.output_dim
  self.heads=FlatResponsibilityHeads(d) if flat else ResponsibilityHeads(d)
 def forward(self,x):return self.heads(self.encoder(x))

def metrics(m,items):
 x,ys=pack(items)
 with torch.no_grad():o=m(x)
 pm=o["resolution"]["membership"].sigmoid()>=.5
 prm=o["resolution"]["room_membership"].sigmoid()>=.5
 pem=o["resolution"]["entity_membership"].sigmoid()>=.5
 ps=o["resolution"]["slot"].argmax(1)
 vals={"target":[],"room":[],"room_topk":[],"entity":[],"slot":[]}
 for i,y in enumerate(ys):
  if not y["resolution_set"]:continue
  vals["target"].append(torch.equal(pm[i].cpu(),torch.tensor(y["resolution"]["membership"],dtype=torch.bool)))
  gold_room=torch.tensor(y["resolution"]["room_membership"],dtype=torch.bool)
  vals["room"].append(torch.equal(prm[i].cpu(),gold_room))
  k=int(gold_room.sum())
  topk=torch.zeros_like(gold_room)
  topk[torch.topk(o["resolution"]["room_membership"][i].cpu(),k).indices]=True
  vals["room_topk"].append(torch.equal(topk,gold_room))
  vals["entity"].append(torch.equal(pem[i].cpu(),torch.tensor(y["resolution"]["entity_membership"],dtype=torch.bool)))
  vals["slot"].append(int(ps[i])==y["resolution"]["slot"])
 return {k:(sum(map(bool,v))/len(v) if v else None) for k,v in vals.items()}|{"n":len(vals["target"])}

def room_diagnostics(m,items):
 x,ys=pack(items)
 with torch.no_grad():p=m(x)["resolution"]["room_membership"].sigmoid().cpu()
 out=[]
 for i,y in enumerate(ys):
  if y["resolution_set"]:
   out.append({"group":items[i]["row"]["contrast_group"],"gold":y["resolution"]["room_membership"],
    "prob":[round(float(v),4) for v in p[i]],"pred":[int(v>=.5) for v in p[i]]})
 return out

def train(g,seed,flat,epochs,dataset):
 torch.manual_seed(seed);m=Model(g,seed,flat);x,ys=pack(rows("train",dataset));t=batch_targets(ys)
 opt=torch.optim.AdamW(m.parameters(),lr=.003,weight_decay=.01)
 for _ in range(epochs):
  opt.zero_grad();o=m(x)
  loss,_=joint_loss(o,t,{"semantic":1,"resolution":1,"judgement":1},
   masks={"resolution_one":t["resolution_one_mask"],"resolution_set":t["resolution_set_mask"]})
  loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1);opt.step()
 return m

def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",default="artifacts/flywire/connectome.json")
 ap.add_argument("--epochs",type=int,default=120);ap.add_argument("--dataset",default="v3",choices=["v3","v4"])
 ap.add_argument("--out",default="artifacts/v3-flat-vs-compositional");a=ap.parse_args()
 g=json.loads(Path(a.graph).read_text());report={"truth":f"{a.dataset}_flat_vs_compositional_room_ranking","regimes":{}}
 for name,flat in (("flat_16_target",True),("compositional_room_entity",False)):
  report["regimes"][name]=[]
  for seed in (2783,3783,4783):
   m=train(g,seed,flat,a.epochs,a.dataset)
   report["regimes"][name].append({"seed":seed,
    **{s:metrics(m,rows(s,a.dataset)) for s in ("train","dev","test")},
    "room_diagnostics":{s:room_diagnostics(m,rows(s,a.dataset)) for s in ("dev","test")}})
 Path(a.out).mkdir(parents=True,exist_ok=True);Path(a.out,"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print(json.dumps(report,ensure_ascii=False))
if __name__=="__main__":main()
