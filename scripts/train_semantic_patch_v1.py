#!/usr/bin/env python3
"""FlyWire-gated semantic-only patch predictor; never predicts target identity or ThingModel slot."""
import argparse,json
from pathlib import Path
import torch
from train_flywire import digest,EXPECTED_SHA256
from train_flywire_delta import text_features,GRAPH_SHA
from train_flywire_whole_home_patch import context_features
from flywire_gated_patch_net import FlyWireGatedPatchNet
from whole_home_patch_corpus_v11 import build
from semantic_patch_contract import OPS,CARD,DIR,encode
class Net(torch.nn.Module):
 def __init__(self,g,disconnect=False):
  super().__init__();self.core=FlyWireGatedPatchNet(g,disconnect=disconnect);n=len(self.core.read_idx)
  self.op=torch.nn.Linear(n,len(OPS));self.card=torch.nn.Linear(n,len(CARD));self.direction=torch.nn.Linear(n,len(DIR));self.value=torch.nn.Linear(n,2)
 def forward(self,x):
  c=self.core;b=x.shape[0];n=len(c.text_idx)+len(c.ctx_idx)+len(c.read_idx);drive=torch.zeros((b,n))
  drive[:,c.text_idx]=c.text_encoder(x[:,:512]);drive[:,c.ctx_idx]=c.ctx_encoder(x[:,512:]);h=torch.tanh(drive);w=c.base*2*torch.sigmoid(c.gain)
  for _ in range(8):
   rec=torch.zeros_like(h)
   if not c.disconnect:rec.index_add_(1,c.post,h[:,c.pre]*w)
   h=.35*h+.65*torch.tanh(drive+rec)
  z=h[:,c.read_idx];return self.op(z),self.card(z),self.direction(z),self.value(z)
def pack(rows):
 x=torch.stack([torch.cat([text_features(t["text"]),context_features(t)]) for t in rows]); labs=[encode(t) for t in rows]
 y=torch.tensor([[OPS.index(a["op"]),CARD.index(a["cardinality"]),DIR.index(a["direction"]),int(a["has_value"])] for a in labs]);return x,y
def score(m,rows):
 x,y=pack(rows)
 with torch.no_grad():p=torch.stack([z.argmax(1) for z in m(x)],1)
 exact=(p==y).all(1);fam={}
 for i,r in enumerate(rows):fam.setdefault(r["family"],[]).append(bool(exact[i]))
 return {"exact":float(exact.float().mean()),"op":float((p[:,0]==y[:,0]).float().mean()),"cardinality":float((p[:,1]==y[:,1]).float().mean()),"direction":float((p[:,2]==y[:,2]).float().mean()),"value_semantics":float((p[:,3]==y[:,3]).float().mean()),"family":{k:sum(v)/len(v) for k,v in sorted(fam.items())}}
def train(g,tr,dev,epochs,disconnect=False):
 m=Net(g,disconnect);x,y=pack(tr);opt=torch.optim.Adam(m.parameters(),lr=.006);best=None
 for e in range(1,epochs+1):
  opt.zero_grad();zs=m(x);loss=(per_example_loss(zs,y)*weights).mean();loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1);opt.step()
  if e%10==0:
   s=score(m,dev)["exact"]
   if best is None or s>best[0]:best=(s,e,{k:v.detach().cpu().clone() for k,v in m.state_dict().items()});bad=0\n   else:bad+=1\n   if bad>=8:break
 m.load_state_dict(best[2]);return m,best[1]
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",default="artifacts/flywire/connectome.json");ap.add_argument("--epochs",type=int,default=400);ap.add_argument("--out",type=Path,default=Path("artifacts/semantic-patch-v1"));a=ap.parse_args()
 g=json.loads(Path(a.graph).read_text());assert g["source_sha256"]==EXPECTED_SHA256 and digest(a.graph)==GRAPH_SHA;d=build();rep={"truth":"semantic_only_patch_v11_contextual_matched_pairs","train":len(d["train"]),"dev":len(d["dev"]),"diagnostic":len(d["sealed"]),"runs":{}}
 for name,off in [("real",False),("disconnected",True)]:
  candidates=[]
  for seed in ([2783,3783,4783] if name=="real" else [3783]):
   m,ep=train(g,d["train"],d["dev"],a.epochs,off,seed);candidates.append((score(m,d["dev"])["exact"],seed,m,ep))
  _,seed,m,ep=max(candidates,key=lambda z:z[0]);rep["runs"][name]={"epoch":ep,"seed":seed,"train":score(m,d["train"]),"dev":score(m,d["dev"]),"diagnostic":score(m,d["sealed"])}
  if name=="real":a.out.mkdir(parents=True,exist_ok=True);torch.save({"state_dict":m.state_dict(),"graph_sha":GRAPH_SHA},a.out/"model.pt")
 a.out.mkdir(parents=True,exist_ok=True);(a.out/"report.json").write_text(json.dumps(rep,ensure_ascii=False,indent=2));print(json.dumps(rep,ensure_ascii=False))
if __name__=="__main__":main()
