#!/usr/bin/env python3
"""Regularized FlyWire-gated semantic predictor with train-only model selection."""
import argparse,json,re
from collections import Counter,defaultdict
from pathlib import Path
import torch
from train_flywire import digest,EXPECTED_SHA256
from train_flywire_delta import text_features,GRAPH_SHA
from semantic_context_features import features as context_features
from flywire_gated_patch_net import FlyWireGatedPatchNet
from whole_home_patch_corpus_v12 import build
from semantic_patch_contract import OPS,CARD,DIR,encode
from flywire_topology_ablation import topology,MODES

class Net(torch.nn.Module):
 def __init__(self,g,mode="real",seed=3783):
  super().__init__();torch.manual_seed(seed);self.core=FlyWireGatedPatchNet(g,seed=seed,disconnect=(mode=="disconnected"))
  pre,post,base=topology(g,mode,seed);self.core.pre=pre;self.core.post=post
  den=torch.zeros(len(g["root_ids"])).index_add_(0,post,base.abs());self.core.base=.9*base/den[post].clamp_min(1)
  n=len(self.core.read_idx)
  self.op=torch.nn.Linear(n,len(OPS));self.card=torch.nn.Linear(n,len(CARD));self.direction=torch.nn.Linear(n,len(DIR));self.value=torch.nn.Linear(n,2)
 def forward(self,x):
  c=self.core;b=x.shape[0];n=len(c.text_idx)+len(c.ctx_idx)+len(c.read_idx);drive=torch.zeros((b,n),device=x.device)
  drive[:,c.text_idx]=c.text_encoder(x[:,:512]);drive[:,c.ctx_idx]=c.ctx_encoder(x[:,512:]);h=torch.tanh(drive);w=c.base*2*torch.sigmoid(c.gain)
  for _ in range(8):
   rec=torch.zeros_like(h)
   if not c.disconnect:rec.index_add_(1,c.post,h[:,c.pre]*w)
   h=.35*h+.65*torch.tanh(drive+rec)
  z=h[:,c.read_idx];return self.op(z),self.card(z),self.direction(z),self.value(z)

def pack(rows):
 x=torch.stack([torch.cat([text_features(t["text"]),context_features(t)]) for t in rows]);labs=[encode(t) for t in rows]
 y=torch.tensor([[OPS.index(a["op"]),CARD.index(a["cardinality"]),DIR.index(a["direction"]),int(a["has_value"])] for a in labs]);return x,y

def score(m,rows):
 x,y=pack(rows)
 with torch.no_grad():p=torch.stack([z.argmax(1) for z in m(x)],1)
 exact=(p==y).all(1);fam={}
 for i,r in enumerate(rows):fam.setdefault(r["family"],[]).append(bool(exact[i]))
 return {"exact":float(exact.float().mean()),"op":float((p[:,0]==y[:,0]).float().mean()),"cardinality":float((p[:,1]==y[:,1]).float().mean()),"direction":float((p[:,2]==y[:,2]).float().mean()),"value_semantics":float((p[:,3]==y[:,3]).float().mean()),"family":{k:sum(v)/len(v) for k,v in sorted(fam.items())}}

def surface_group(text):
 s=re.sub(r"\\d+","<N>","".join(text.split()))
 s=re.sub(r"客厅|主卧|书房|次卧","<ROOM>",s)
 s=re.sub(r"空调|灯光?|窗户","<ENTITY>",s)
 return s
def stratified_split(rows):
 # Hold out entire normalized surface groups; never split paraphrase siblings.
 by_family=defaultdict(lambda:defaultdict(list))
 for r in rows:by_family[r["family"]][surface_group(r["text"])].append(r)
 fit=[];sel=[]
 for fam,groups in sorted(by_family.items()):
  keys=sorted(groups)
  hold=max(1,len(keys)//5) if len(keys)>=3 else 0
  held=set(keys[-hold:] if hold else [])
  for k,xs in groups.items():(sel if k in held else fit).extend(xs)
 return fit,sel

def balanced_weights(rows):
 c=Counter(r["family"] for r in rows);w=torch.tensor([1.0/c[r["family"]] for r in rows]);return w/w.mean()

def per_example_loss(zs,y):
 return sum(torch.nn.functional.cross_entropy(zs[i],y[:,i],reduction="none",label_smoothing=.05) for i in range(4))

def counterfactual_pairs(rows):
 groups=defaultdict(list)
 for i,r in enumerate(rows):groups[r["text"]].append((i,encode(r)))
 out=[]
 for xs in groups.values():
  if len(xs)<2:continue
  for a in range(len(xs)):
   for b in range(a+1,len(xs)):
    ia,ya=xs[a];ib,yb=xs[b]
    va=(OPS.index(ya["op"]),CARD.index(ya["cardinality"]),DIR.index(ya["direction"]),int(ya["has_value"]))
    vb=(OPS.index(yb["op"]),CARD.index(yb["cardinality"]),DIR.index(yb["direction"]),int(yb["has_value"]))
    if va!=vb:out.append((ia,ib,va,vb))
 return out
def train(g,tr,selection,epochs,mode="real",seed=3783):
 m=Net(g,mode,seed);x,y=pack(tr);weights=balanced_weights(tr);cf=counterfactual_pairs(tr);opt=torch.optim.AdamW(m.parameters(),lr=.004,weight_decay=.01);best=None;bad=0
 for e in range(1,epochs+1):
  opt.zero_grad();zs=m(x);loss=(per_example_loss(zs,y)*weights).mean()
  # Pairwise counterfactual margin: identical text with different semantic truth must separate.
  if cf:
   cf_loss=0.0
   for ia,ib,va,vb in cf:
    for h,(ga,gb) in enumerate(zip(va,vb)):
     if ga!=gb:
      pa=torch.log_softmax(zs[h][ia],0);pb=torch.log_softmax(zs[h][ib],0)
      cf_loss+=torch.relu(torch.tensor(.5)-(pa[ga]-pa[gb]))+torch.relu(torch.tensor(.5)-(pb[gb]-pb[ga]))
   loss=loss+.15*cf_loss/len(cf)
  loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1);opt.step()
  if e%10==0:
   s=score(m,selection)["exact"]
   if best is None or s>best[0]:best=(s,e,{k:v.detach().cpu().clone() for k,v in m.state_dict().items()});bad=0
   else:bad+=1
   if bad>=8:break
 m.load_state_dict(best[2]);return m,best[1]

def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",default="artifacts/flywire/connectome.json");ap.add_argument("--epochs",type=int,default=450);ap.add_argument("--out",type=Path,default=Path("artifacts/semantic-patch-v1"));a=ap.parse_args()
 torch.set_num_threads(2);g=json.loads(Path(a.graph).read_text());assert g["source_sha256"]==EXPECTED_SHA256 and digest(a.graph)==GRAPH_SHA
 d=build();fit,selection=stratified_split(d["train"]);rep={"truth":"semantic_patch_v14_"+d["truth"]+"_four_topology_ablation","train":len(d["train"]),"fit":len(fit),"selection":len(selection),"dev":len(d["dev"]),"diagnostic":len(d["sealed"]),"family_counts":dict(Counter(r["family"] for r in d["train"])),"runs":{}}
 for name in MODES:
  candidates=[];seed_reports=[]
  for seed in [2783,3783,4783]:
   m,ep=train(g,fit,selection,a.epochs,name,seed);sr={"seed":seed,"epoch":ep,"selection":score(m,selection),"dev":score(m,d["dev"]),"diagnostic":score(m,d["sealed"])};seed_reports.append(sr);candidates.append((sr["selection"]["exact"],seed,m,ep))
  _,seed,m,ep=max(candidates,key=lambda z:z[0]);rep["runs"][name]={"seeds":seed_reports,"selected_seed":seed,"epoch":ep,"fit":score(m,fit),"selection":score(m,selection),"train_all":score(m,d["train"]),"dev":score(m,d["dev"]),"diagnostic":score(m,d["sealed"])}
  if name=="real":
   a.out.mkdir(parents=True,exist_ok=True);torch.save({"state_dict":m.state_dict(),"graph_sha":GRAPH_SHA,"source_sha256":EXPECTED_SHA256,"seed":seed,"selected_epoch":ep,"truth":rep["truth"]},a.out/"model.pt")
 a.out.mkdir(parents=True,exist_ok=True);(a.out/"report.json").write_text(json.dumps(rep,ensure_ascii=False,indent=2));print(json.dumps(rep,ensure_ascii=False))
if __name__=="__main__":main()
