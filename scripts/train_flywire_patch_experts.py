#!/usr/bin/env python3
"""Train semantic-expert FlyWire patch decoder on v9, select on dev only."""
import argparse,json
from pathlib import Path
import torch
from train_flywire import digest,EXPECTED_SHA256
from train_flywire_delta import text_features,GRAPH_SHA
from train_flywire_whole_home_patch import context_features
from train_flywire_whole_home_patch_v4 import OPS,ROOMS,ENTITIES,SLOTS,CARDINALITY,DELTA
from whole_home_patch_corpus_v9 import build
from flywire_patch_experts import FlyWirePatchExperts,EXPERT_NAMES
from patch_expert_router import route_expert
def rows(split):
 out=[]
 for t in split:
  p=t["gold_patches"][0];target=p.get("target") or p.get("to") or {};card="SET2" if p.get("targets") else "ONE";delta=p.get("delta",0)
  lab=[OPS.index(p["op"]),ROOMS.index(target.get("area","NONE")),ENTITIES.index(target.get("entity","NONE")),SLOTS.index(p.get("slot","NONE") if p.get("slot","NONE") in SLOTS else "NONE"),CARDINALITY.index(card),DELTA.index("NEG" if delta<0 else "POS" if delta>0 else "ZERO")]
  expert=EXPERT_NAMES.index(route_expert(p["op"],card))
  x=torch.cat([text_features(t["text"]),context_features(t)])
  out.append((x,torch.tensor(lab),expert,t))
 return out
def split(z):
 sizes=[len(OPS),len(ROOMS),len(ENTITIES),len(SLOTS),len(CARDINALITY),len(DELTA)];o=[];i=0
 for n in sizes:o.append(z[:,i:i+n]);i+=n
 return o
def objective(m,rs):
 x=torch.stack([r[0] for r in rs]);y=torch.stack([r[1] for r in rs]);e=torch.tensor([r[2] for r in rs]);router,outs=m(x)
 loss=2*torch.nn.functional.cross_entropy(router,e)
 for ei,name in enumerate(EXPERT_NAMES):
  mask=e==ei
  if mask.any():
   hs=split(outs[name][mask])
   for j in range(6):loss+=torch.nn.functional.cross_entropy(hs[j],y[mask,j])
 return loss
def score(m,rs):
 x=torch.stack([r[0] for r in rs]);y=torch.stack([r[1] for r in rs]);e=torch.tensor([r[2] for r in rs])
 with torch.no_grad():
  router,outs=m(x);pe=router.argmax(1);pred=torch.zeros_like(y)
  for ei,name in enumerate(EXPERT_NAMES):
   mask=pe==ei
   if mask.any():pred[mask]=torch.stack([h.argmax(1) for h in split(outs[name][mask])],1)
 exact=(pred==y).all(1)&(pe==e);fam={}
 for i,r in enumerate(rs):fam.setdefault(r[3]["family"],[]).append(bool(exact[i]))
 return {"exact":float(exact.float().mean()),"router":float((pe==e).float().mean()),"op":float((pred[:,0]==y[:,0]).float().mean()),"target":float(((pred[:,1:3]==y[:,1:3]).all(1)).float().mean()),"slot":float((pred[:,3]==y[:,3]).float().mean()),"family":{k:sum(v)/len(v) for k,v in sorted(fam.items())},"examples":len(rs)}
def main():
 a=argparse.ArgumentParser();a.add_argument("--graph",default="artifacts/flywire/connectome.json");a.add_argument("--epochs",type=int,default=500);a.add_argument("--out",type=Path,default=Path("artifacts/flywire-patch-experts-v1"));q=a.parse_args()
 g=json.loads(Path(q.graph).read_text());assert g["source_sha256"]==EXPECTED_SHA256 and digest(q.graph)==GRAPH_SHA;d=build();tr,dev,final=map(rows,[d["train"],d["dev"],d["sealed"]]);rep={"truth":"flywire_semantic_experts_v1","train":len(tr),"dev":len(dev),"final":len(final),"runs":{}}
 for name,off in [("real",False),("disconnected",True)]:
  m=FlyWirePatchExperts(g,disconnect=off);opt=torch.optim.Adam(m.parameters(),lr=.005);best=None
  for ep in range(1,q.epochs+1):
   opt.zero_grad();loss=objective(m,tr);loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1);opt.step()
   if ep%10==0:
    s=score(m,dev)["exact"]
    if best is None or s>best[0]:best=(s,ep,{k:v.detach().cpu().clone() for k,v in m.state_dict().items()})
  m.load_state_dict(best[2]);rep["runs"][name]={"epoch":best[1],"train":score(m,tr),"dev":score(m,dev),"final":score(m,final)}
 q.out.mkdir(parents=True,exist_ok=True);(q.out/"report.json").write_text(json.dumps(rep,ensure_ascii=False,indent=2));print(json.dumps(rep,ensure_ascii=False))
if __name__=="__main__":main()
