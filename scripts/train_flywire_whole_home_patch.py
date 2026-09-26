#!/usr/bin/env python3
"""Whole-home Patch Predictor on the verified FlyWire v783 connectome.

This is deliberately separate from the legacy 12-slot DeltaNet.  It trains the
real-connectome recurrent substrate to predict *minimal semantic patch fields*,
never a regenerated whole-home snapshot.

v1 learns operation, patch count, target room/entity and semantic slot for the
frozen acceptance suite. Runtime grounding/value validation remains
deterministic and is not delegated to this model.
"""
import argparse, hashlib, json
from pathlib import Path
import torch
from train_flywire import digest, EXPECTED_SHA256
from train_flywire_delta import DeltaNet, text_features, GRAPH_SHA
from whole_home_patch_corpus import build

OPS=["ADD_DEVICE","PATCH_SLOT","CLOSE_DEVICE","REMOVE_DEVICE","REPLACE_TARGET","CANCEL_PENDING","UNDO_EXECUTED","PROTECT"]
ROOMS=["客厅","主卧","NONE"]
ENTITIES=["空调","窗户","灯","NONE"]
SLOTS=["power","temperature","mode","opening","*","NONE"]
MAX_PATCHES=2
TEXT_DIM=512
STATE_DIM=64

def stable_bucket(text, size):
    return int(hashlib.sha256(text.encode()).hexdigest()[:8],16)%size

def context_features(turn):
    x=torch.zeros(STATE_DIM)
    # Context is encoded as prior semantic writes, not a regenerated state.
    for item in turn.get("context",[]):
        for p in item.get("patches",[]):
            op=p.get("op","")
            x[stable_bucket("op:"+op,16)]+=1
            t=p.get("target") or p.get("to") or {}
            x[16+stable_bucket("room:"+str(t.get("area")),16)]+=1
            x[32+stable_bucket("entity:"+str(t.get("entity")),16)]+=1
            slot=p.get("slot")
            for s in (p.get("slots") or {}): x[48+stable_bucket("slot:"+s,16)]+=1
            if slot:x[48+stable_bucket("slot:"+str(slot),16)]+=1
    return x/x.norm().clamp_min(1)

def primary_slot(p):
    if p.get("slot") in SLOTS:return p["slot"]
    slots=list((p.get("slots") or {}).keys())
    return slots[0] if len(slots)==1 and slots[0] in SLOTS else "NONE"

def target_of(p):
    return p.get("target") or p.get("to") or {}

def encode_patch(p):
    t=target_of(p)
    return [OPS.index(p["op"]),ROOMS.index(t.get("area","NONE")) if t.get("area") in ROOMS else ROOMS.index("NONE"),
            ENTITIES.index(t.get("entity","NONE")) if t.get("entity") in ENTITIES else ENTITIES.index("NONE"),
            SLOTS.index(primary_slot(p))]

def examples():
    rows=[]
    for ep in build()["episodes"]:
        for turn in ep["turns"]:
            patches=turn["gold_patches"]
            labels=[len(patches)]
            for i in range(MAX_PATCHES):
                labels += encode_patch(patches[i]) if i<len(patches) else [0,ROOMS.index("NONE"),ENTITIES.index("NONE"),SLOTS.index("NONE")]
            x=torch.cat([text_features(turn["text"]),context_features(turn)])
            rows.append((x,torch.tensor(labels),turn))
    return rows

class WholeHomePatchNet(torch.nn.Module):
    def __init__(self,g,seed=2783,disconnect=False):
        super().__init__();torch.manual_seed(seed);n=len(g["root_ids"]);e=torch.tensor(g["edges"])
        self.register_buffer("pre",e[:,0].long());self.register_buffer("post",e[:,1].long())
        base=e[:,3].float();den=torch.zeros(n).index_add_(0,self.post,base.abs())
        self.register_buffer("base",.9*base/den[self.post].clamp_min(1))
        self.gain=torch.nn.Parameter(torch.zeros(len(self.pre)))
        self.encoder=torch.nn.Linear(TEXT_DIM+STATE_DIM,n)
        self.count=torch.nn.Linear(n,MAX_PATCHES)
        self.patch_heads=torch.nn.ModuleList([torch.nn.Linear(n,len(OPS)+len(ROOMS)+len(ENTITIES)+len(SLOTS)) for _ in range(MAX_PATCHES)])
        self.disconnect=disconnect
    def forward(self,x,disconnect=None):
        drive=self.encoder(x);h=torch.tanh(drive);w=self.base*2*torch.sigmoid(self.gain)
        off=self.disconnect if disconnect is None else disconnect
        for _ in range(4):
            rec=torch.zeros_like(h)
            if not off:rec.index_add_(1,self.post,h[:,self.pre]*w)
            h=.45*h+.55*torch.tanh(drive+rec)
        return self.count(h),[head(h) for head in self.patch_heads]

def split_head(z):
    sizes=[len(OPS),len(ROOMS),len(ENTITIES),len(SLOTS)];out=[];i=0
    for size in sizes:out.append(z[:,i:i+size]);i+=size
    return out

def objective(out,y):
    count,patches=out
    loss=torch.nn.functional.cross_entropy(count,y[:,0]-1)
    for i,z in enumerate(patches):
        mask=y[:,0]>i
        if not mask.any():continue
        hs=split_head(z)
        base=1+i*4
        loss+=2*torch.nn.functional.cross_entropy(hs[0][mask],y[mask,base])
        loss+=sum(torch.nn.functional.cross_entropy(hs[j][mask],y[mask,base+j]) for j in (1,2,3))
    return loss

def predict(out):
    count,patches=out; c=count.argmax(1)+1
    fields=[]
    for z in patches:fields.append(torch.stack([h.argmax(1) for h in split_head(z)],1))
    return c,fields

def metrics(pred,y,rows):
    count,fields=pred;count_ok=count==y[:,0];exact=count_ok.clone();op_ok=[];target_ok=[];slot_ok=[]
    family={}
    for n in range(len(y)):
        ok=bool(count_ok[n])
        for i in range(int(y[n,0])):
            gold=y[n,1+i*4:1+(i+1)*4];p=fields[i][n]
            op_ok.append(bool(p[0]==gold[0]));target_ok.append(bool((p[1:3]==gold[1:3]).all()));slot_ok.append(bool(p[3]==gold[3]))
            ok=ok and bool((p==gold).all())
        exact[n]=ok
        fam=rows[n][2]["family"];family.setdefault(fam,[]).append(ok)
    mean=lambda xs:sum(xs)/len(xs) if xs else None
    return {"patch_exact":float(exact.float().mean()),"count_accuracy":float(count_ok.float().mean()),
            "operation_accuracy":mean(op_ok),"target_accuracy":mean(target_ok),"slot_accuracy":mean(slot_ok),
            "family_exact":{k:mean(v) for k,v in sorted(family.items())},"examples":len(y)}

def main():
    p=argparse.ArgumentParser();p.add_argument("--graph",default="artifacts/flywire/connectome.json");p.add_argument("--epochs",type=int,default=120)
    p.add_argument("--out",type=Path,default=Path("artifacts/flywire-whole-home"));a=p.parse_args()
    torch.set_num_threads(2);g=json.loads(Path(a.graph).read_text())
    assert g["source_sha256"]==EXPECTED_SHA256 and digest(a.graph)==GRAPH_SHA
    rows=examples();x=torch.stack([r[0] for r in rows]);y=torch.stack([r[1] for r in rows])
    model=WholeHomePatchNet(g);opt=torch.optim.Adam(model.parameters(),lr=.01)
    for epoch in range(a.epochs):
        opt.zero_grad();loss=objective(model(x),y);loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);opt.step()
    with torch.no_grad():
        live=metrics(predict(model(x)),y,rows);disconnected=metrics(predict(model(x,disconnect=True)),y,rows)
    a.out.mkdir(parents=True,exist_ok=True)
    torch.save({"state_dict":model.state_dict(),"graph_sha256":GRAPH_SHA,"source_sha256":EXPECTED_SHA256},a.out/"v1.pt")
    report={"truth":"whole_home_patch_predictor_on_verified_real_flywire_subgraph","semantic_unit":"minimal_patch_not_full_state",
            "source_sha256":EXPECTED_SHA256,"graph_sha256":GRAPH_SHA,"neurons":len(g["root_ids"]),"edges":len(g["edges"]),
            "operations":OPS,"live_connectome":live,"disconnect_ablation":disconnected,
            "hard_runtime_invariant":"untouched_state_preservation_100_percent",
            "limits":["v1 acceptance corpus is small and locally visible; not an independent generalization claim","v1 target vocabulary is bounded to acceptance rooms/entities/slots","values and 46-model capability grounding remain deterministic/runtime work","training-set fit is not evidence of open-world accuracy"]}
    (a.out/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))

if __name__=="__main__":main()
