#!/usr/bin/env python3
"""FlyWire-gated long-context judgement baseline."""
import argparse,json,hashlib
from pathlib import Path
import torch
from train_flywire import digest,EXPECTED_SHA256
from train_flywire_delta import text_features,GRAPH_SHA
from flywire_gated_patch_net import FlyWireGatedPatchNet
from context_judgement_corpus_v2 import build
DECISIONS=["EXECUTE","CLARIFY","BLOCK","NOOP","CANCEL_PENDING","UNDO_EXECUTED"]
CTX=64
def bucket(s,n=CTX):return int(hashlib.sha256(s.encode()).hexdigest()[:8],16)%n
def ctx_features(bg):
 x=torch.zeros(CTX)
 def add(k,v,w=1):
  if isinstance(v,list):
   for z in v:add(k,z,w)
  elif isinstance(v,dict):
   for a,b in sorted(v.items()):add(k+"."+a,b,w)
  else:x[bucket(f"{k}:{v}")]+=w
 for k,v in sorted(bg.items()):add(k,v,2 if k in {"focus","pending","executed","protected","rain","speaker","quiet_hours","automation"} else 0.35)
 return x/x.norm().clamp_min(1)
class Judge(torch.nn.Module):
 def __init__(self,g,disconnect=False):
  super().__init__();self.core=FlyWireGatedPatchNet(g,seed=5783,disconnect=disconnect);self.head=torch.nn.Linear(len(self.core.read_idx),len(DECISIONS))
 def forward(self,x):
  c=self.core;b=x.shape[0];n=len(c.text_idx)+len(c.ctx_idx)+len(c.read_idx);drive=torch.zeros((b,n))
  drive[:,c.text_idx]=c.text_encoder(x[:,:512]);drive[:,c.ctx_idx]=c.ctx_encoder(x[:,512:]);h=torch.tanh(drive);w=c.base*2*torch.sigmoid(c.gain)
  for _ in range(8):
   rec=torch.zeros_like(h)
   if not c.disconnect:rec.index_add_(1,c.post,h[:,c.pre]*w)
   h=.35*h+.65*torch.tanh(drive+rec)
  return self.head(h[:,c.read_idx])
def enc(rows):
 x=torch.stack([torch.cat([text_features(r["utterance"]),ctx_features(r["background"])]) for r in rows]);y=torch.tensor([DECISIONS.index(r["judgement"]["decision"]) for r in rows]);return x,y
def score(m,rows):
 x,y=enc(rows)
 with torch.no_grad():p=m(x).argmax(1)
 fam={}
 for i,r in enumerate(rows):fam.setdefault(r["family"],[]).append(bool(p[i]==y[i]))
 return {"accuracy":float((p==y).float().mean()),"family":{k:sum(v)/len(v) for k,v in sorted(fam.items())},"examples":len(rows)}
def train(g,tr,dev,epochs,disconnect=False):
 m=Judge(g,disconnect);x,y=enc(tr);opt=torch.optim.Adam(m.parameters(),lr=.006);best=None
 for e in range(1,epochs+1):
  opt.zero_grad();loss=torch.nn.functional.cross_entropy(m(x),y);loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1);opt.step()
  if e%10==0:
   s=score(m,dev)["accuracy"]
   if best is None or s>best[0]:best=(s,e,{k:v.detach().cpu().clone() for k,v in m.state_dict().items()})
 m.load_state_dict(best[2]);return m,best[1]
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",default="artifacts/flywire/connectome.json");ap.add_argument("--epochs",type=int,default=300);ap.add_argument("--out",type=Path,default=Path("artifacts/context-judgement-v2"));a=ap.parse_args()
 g=json.loads(Path(a.graph).read_text());assert g["source_sha256"]==EXPECTED_SHA256 and digest(a.graph)==GRAPH_SHA
 d=build();rep={"truth":d["truth"],"train":len(d["train"]),"dev":len(d["dev"]),"final":len(d["final"]),"runs":{}}
 for name,off in [("real",False),("disconnected",True)]:
  m,ep=train(g,d["train"],d["dev"],a.epochs,off);rep["runs"][name]={"selected_epoch":ep,"train":score(m,d["train"]),"dev":score(m,d["dev"]),"final":score(m,d["final"])}
 a.out.mkdir(parents=True,exist_ok=True);(a.out/"report.json").write_text(json.dumps(rep,ensure_ascii=False,indent=2));print(json.dumps(rep,ensure_ascii=False))
if __name__=="__main__":main()
