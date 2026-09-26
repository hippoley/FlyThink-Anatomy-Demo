#!/usr/bin/env python3
"""V4 FlyWire-gated semantic heads for set and relative whole-home patches."""
import argparse,json,copy
from pathlib import Path
import torch
from train_flywire import digest,EXPECTED_SHA256
from train_flywire_delta import GRAPH_SHA,text_features
from train_flywire_whole_home_patch import context_features
from flywire_gated_patch_net import FlyWireGatedPatchNet
from whole_home_patch_corpus_v8 import build
from bind_relative_patch import bind_relative

OPS=["ADD_DEVICE","PATCH_SLOT","PATCH_RELATIVE","CLOSE_DEVICE","REMOVE_DEVICE","REPLACE_TARGET","CANCEL_PENDING","UNDO_EXECUTED","PROTECT"]
ROOMS=["客厅","主卧","NONE"]; ENTITIES=["空调","窗户","灯","NONE"]; SLOTS=["power","temperature","mode","opening","*","NONE"]
CARD=["ONE","SET2"]; DELTA=["NEG","ZERO","POS"]

class V4(torch.nn.Module):
 def __init__(self,g,disconnect=False):
  super().__init__();self.core=FlyWireGatedPatchNet(g,disconnect=disconnect);r=len(self.core.read_idx)
  # Replace legacy patch head with explicit v4 semantic heads over the gated read population.
  self.op=torch.nn.Linear(r,len(OPS));self.room=torch.nn.Linear(r,len(ROOMS));self.entity=torch.nn.Linear(r,len(ENTITIES));self.slot=torch.nn.Linear(r,len(SLOTS));self.card=torch.nn.Linear(r,len(CARD));self.delta=torch.nn.Linear(r,len(DELTA))
 def forward(self,x):
  b=x.shape[0];n=len(self.core.text_idx)+len(self.core.ctx_idx)+len(self.core.read_idx);drive=torch.zeros((b,n),device=x.device)
  drive[:,self.core.text_idx]=self.core.text_encoder(x[:,:512]);drive[:,self.core.ctx_idx]=self.core.ctx_encoder(x[:,512:])
  h=torch.tanh(drive);w=self.core.base*2*torch.sigmoid(self.core.gain)
  for _ in range(8):
   rec=torch.zeros_like(h)
   if not self.core.disconnect:rec.index_add_(1,self.core.post,h[:,self.core.pre]*w)
   h=.35*h+.65*torch.tanh(drive+rec)
  z=h[:,self.core.read_idx];return [self.op(z),self.room(z),self.entity(z),self.slot(z),self.card(z),self.delta(z)]

def enc(t):
 p=t["gold_patches"][0];targets=p.get("targets");target=p.get("target") or (targets[0] if targets else {})
 d=p.get("delta",0);return torch.tensor([OPS.index(p["op"]),ROOMS.index(target.get("area","NONE")),ENTITIES.index(target.get("entity","NONE")),SLOTS.index(p.get("slot","NONE")),CARD.index("SET2" if targets and len(targets)==2 else "ONE"),DELTA.index("NEG" if d<0 else "POS" if d>0 else "ZERO")])
def pack(rows):
 return torch.stack([torch.cat([text_features(t["text"]),context_features(t)]) for t in rows]),torch.stack([enc(t) for t in rows])
def score(m,x,y,rows):
 with torch.no_grad(): pred=torch.stack([z.argmax(1) for z in m(x)],1)
 exact=(pred==y).all(1);fam={}
 for i,t in enumerate(rows):fam.setdefault(t["family"],[]).append(bool(exact[i]))
 # Deployment-aware exact: relative target/slot are constrained by deterministic binding.
 with torch.no_grad():
  bound_exact=[]
  for i,t in enumerate(rows):
   ok=bool(exact[i])
   if OPS[int(pred[i,0])]=="PATCH_RELATIVE":
    proposal={"op":"PATCH_RELATIVE","delta": -1 if DELTA[int(pred[i,5])]=="NEG" else 1 if DELTA[int(pred[i,5])]=="POS" else 0}
    try:
     b=bind_relative(t["text"],proposal,t.get("lifecycle",{}));g=t["gold_patches"][0]
     ok=(b.get("target")==g.get("target") and b.get("slot")==g.get("slot") and proposal["delta"]==g.get("delta"))
    except ValueError: ok=False
   bound_exact.append(ok)
 return {"exact":sum(bound_exact)/len(bound_exact),"raw_neural_exact":float(exact.float().mean()),"op":float((pred[:,0]==y[:,0]).float().mean()),"target":float(((pred[:,1:3]==y[:,1:3]).all(1)).float().mean()),"slot":float((pred[:,3]==y[:,3]).float().mean()),"cardinality":float((pred[:,4]==y[:,4]).float().mean()),"relative_direction":float((pred[:,5]==y[:,5]).float().mean()),"family_exact":{k:sum(v)/len(v) for k,v in fam.items()},"examples":len(rows)}

def train(g,tr,dev,disconnect,epochs):
 m=V4(g,disconnect);o=torch.optim.Adam(m.parameters(),lr=.006);best=None
 for e in range(epochs):
  o.zero_grad();zs=m(tr[0]);loss=sum(torch.nn.functional.cross_entropy(zs[i],tr[1][:,i]) for i in range(6));loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1);o.step()
  if (e+1)%10==0:
   q=score(m,dev[0],dev[1],dev[2]);key=(q["exact"],q["op"],q["target"],q["slot"],q["relative_direction"])
   if best is None or key>best[0]:best=(key,e+1,copy.deepcopy(m.state_dict()))
 m.load_state_dict(best[2]);return m,best[1]

def main():
 a=argparse.ArgumentParser();a.add_argument("--graph",default="artifacts/flywire/connectome.json");a.add_argument("--epochs",type=int,default=240);a.add_argument("--out",type=Path,default=Path("artifacts/flywire-whole-home-v8"));q=a.parse_args()
 g=json.loads(Path(q.graph).read_text());assert g["source_sha256"]==EXPECTED_SHA256 and digest(q.graph)==GRAPH_SHA;d=build();tr=(*pack(d["train"]),d["train"]);dev=(*pack(d["dev"]),d["dev"]);se=(*pack(d["sealed"]),d["sealed"]);q.out.mkdir(parents=True,exist_ok=True)
 rep={"truth":"v8_large_compositional_deployment_eval","source_sha256":EXPECTED_SHA256,"graph_sha256":GRAPH_SHA,"train_examples":len(d["train"]),"dev_examples":len(d["dev"]),"final_test_examples":len(d["sealed"]),"runs":{}}
 for name,disc in [("real",False),("disconnected",True)]:
  m,ep=train(g,tr,dev,disc,q.epochs);rep["runs"][name]={"selected_epoch":ep,"train":score(m,*tr),"dev":score(m,*dev),"final_test":score(m,*se)};torch.save(m.state_dict(),q.out/f"{name}.pt")
 rep["real_minus_disconnected_exact"]=rep["runs"]["real"]["final_test"]["exact"]-rep["runs"]["disconnected"]["final_test"]["exact"]
 fam=rep["runs"]["real"]["final_test"]["family_exact"]
 rep["passes_90_gate"]=rep["runs"]["real"]["final_test"]["exact"]>=0.90 and all(v>=0.90 for v in fam.values())
 rep["gate_detail"]={"overall":rep["runs"]["real"]["final_test"]["exact"],"families":fam,"all_families_ge_90":all(v>=0.90 for v in fam.values())};(q.out/"report.json").write_text(json.dumps(rep,ensure_ascii=False,indent=2));print(json.dumps(rep,ensure_ascii=False))
if __name__=="__main__":main()
