#!/usr/bin/env python3
"""Same-budget structural baselines for the FlyWire GraphDelta decision gate.

This benchmark deliberately reuses the exact feature tensor, labels and
train/development/sealed splits from train_flywire_delta.py.  It asks a narrow
question: does the real FlyWire recurrent topology add value over simpler
bounded state-transition kernels when pretraining and open-language generation
are held out of scope?
"""
import argparse
import copy
import json
import math
import statistics
import time
from pathlib import Path

import torch

from train_flywire import EXPECTED_SHA256, digest
from train_flywire_delta import (
    GRAPH_SHA,
    STATE_DIM,
    TEXT_DIM,
    DeltaNet,
    corpus,
    heads,
    metrics,
    objective,
    pack,
    predict,
    resolve,
    selection_score,
)

OUT_DIM=sum([8,3,4,4,3,3,5,4,3,3,5])
STEP_DIM=TEXT_DIM+STATE_DIM


def parameter_count(model):
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


class MLPBaseline(torch.nn.Module):
    def __init__(self, hidden):
        super().__init__()
        self.net=torch.nn.Sequential(
            torch.nn.Linear(TEXT_DIM*3+STATE_DIM,hidden),
            torch.nn.Tanh(),
            torch.nn.Linear(hidden,OUT_DIM),
        )
    def forward(self,x,disconnect=False):
        del disconnect
        return self.net(x)


class GRUBaseline(torch.nn.Module):
    def __init__(self, hidden):
        super().__init__()
        self.gru=torch.nn.GRU(STEP_DIM,hidden,batch_first=True)
        self.readout=torch.nn.Linear(hidden,OUT_DIM)
    def forward(self,x,disconnect=False):
        del disconnect
        state=x[:,TEXT_DIM*3:]
        seq=torch.stack([
            torch.cat([x[:,0:TEXT_DIM],state],1),
            torch.cat([x[:,TEXT_DIM:TEXT_DIM*2],state],1),
            torch.cat([x[:,TEXT_DIM*2:TEXT_DIM*3],state],1),
        ],1)
        z,_=self.gru(seq)
        return self.readout(z[:,-1])


class TinyTransformerBaseline(torch.nn.Module):
    def __init__(self,d_model,nhead=4,layers=2,ff_mult=4):
        super().__init__()
        self.input=torch.nn.Linear(STEP_DIM,d_model)
        self.pos=torch.nn.Parameter(torch.zeros(1,3,d_model))
        layer=torch.nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=ff_mult*d_model,
            dropout=0.0,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder=torch.nn.TransformerEncoder(layer,num_layers=layers)
        self.readout=torch.nn.Linear(d_model,OUT_DIM)
    def forward(self,x,disconnect=False):
        del disconnect
        state=x[:,TEXT_DIM*3:]
        seq=torch.stack([
            torch.cat([x[:,0:TEXT_DIM],state],1),
            torch.cat([x[:,TEXT_DIM:TEXT_DIM*2],state],1),
            torch.cat([x[:,TEXT_DIM*2:TEXT_DIM*3],state],1),
        ],1)
        z=self.encoder(self.input(seq)+self.pos)
        return self.readout(z.mean(1))


def closest(factory,candidates,target):
    rows=[]
    for value in candidates:
        model=factory(value)
        rows.append((abs(parameter_count(model)-target),value,parameter_count(model)))
    rows.sort()
    _,value,count=rows[0]
    return value,count


def build_models(graph,target_params,seed):
    torch.manual_seed(seed)
    real=DeltaNet(graph,"real",seed=seed)
    rewired=DeltaNet(graph,"rewired",seed=seed)
    disconnected=DeltaNet(graph,"disconnected",seed=seed)
    fly_params=parameter_count(real)

    mlp_h,mlp_params=closest(
        lambda h: MLPBaseline(h),
        range(64,769,8),
        target_params or fly_params,
    )
    gru_h,gru_params=closest(
        lambda h: GRUBaseline(h),
        range(32,513,4),
        target_params or fly_params,
    )
    tr_d,tr_params=closest(
        lambda d: TinyTransformerBaseline(d),
        range(32,257,4),
        target_params or fly_params,
    )

    torch.manual_seed(seed); mlp=MLPBaseline(mlp_h)
    torch.manual_seed(seed); gru=GRUBaseline(gru_h)
    torch.manual_seed(seed); transformer=TinyTransformerBaseline(tr_d)

    return {
        "flywire-real":real,
        "flywire-rewired":rewired,
        "flywire-disconnected":disconnected,
        "mlp":mlp,
        "gru":gru,
        "tiny-transformer":transformer,
    }, {
        "target_params":target_params or fly_params,
        "flywire_params":fly_params,
        "mlp_hidden":mlp_h,
        "mlp_params":mlp_params,
        "gru_hidden":gru_h,
        "gru_params":gru_params,
        "transformer_d_model":tr_d,
        "transformer_params":tr_params,
    }


def required_head_indices(row):
    op=int(row[0])
    count=int(row[1])
    idx=[0,1,2]
    if count>0:
        idx.extend([3,4,5])
        if op in (0,1): # add / revise in the frozen corpus vocabulary
            idx.append(6)
    if count>1:
        idx.extend([7,8,9,10])
    return sorted(set(idx))


def confidence_rows(logits,pred):
    split=heads(logits)
    probs=[torch.softmax(h,dim=1).max(1).values for h in split]
    out=[]
    for i,row in enumerate(pred):
        indexes=required_head_indices(row)
        out.append(float(torch.stack([probs[j][i] for j in indexes]).min()))
    return torch.tensor(out)


def exact_rows(pred,gold):
    eq=pred==gold
    rows=[]
    for i,p in enumerate(pred):
        indexes=required_head_indices(p)
        rows.append(bool(all(bool(eq[i,j]) for j in indexes)))
    return torch.tensor(rows,dtype=torch.bool)


def coverage_at_precision(confidence,exact,target=0.99):
    """Best deployable coverage using a scalar confidence threshold.

    Equal-confidence samples are evaluated as one threshold group.  A real
    deployment cannot keep the correct members of a tie while rejecting the
    incorrect members at the same threshold.
    """
    rows=sorted(
        [(float(confidence[i]),bool(exact[i])) for i in range(len(exact))],
        reverse=True,
    )
    if not rows:
        return {"coverage":0.0,"precision":None,"threshold":None,"committed":0}
    best={"coverage":0.0,"precision":None,"threshold":None,"committed":0}
    correct=0
    committed=0
    i=0
    while i<len(rows):
        threshold=rows[i][0]
        group=[]
        while i<len(rows) and rows[i][0]==threshold:
            group.append(rows[i])
            i+=1
        committed+=len(group)
        correct+=sum(int(ok) for _,ok in group)
        precision=correct/committed
        if precision>=target:
            best={
                "coverage":committed/len(rows),
                "precision":precision,
                "threshold":threshold,
                "committed":committed,
            }
    return best


def latency_ms(model,x,repeats=80):
    sample=x[:min(len(x),64)]
    model.eval()
    with torch.no_grad():
        for _ in range(10):
            model(sample)
        values=[]
        for _ in range(repeats):
            t0=time.perf_counter_ns()
            model(sample)
            values.append((time.perf_counter_ns()-t0)/1e6)
    return {
        "batch_size":len(sample),
        "median_ms":statistics.median(values),
        "p95_ms":sorted(values)[max(0,math.ceil(.95*len(values))-1)],
    }


def neutral_objective(z,y):
    h=heads(z)
    loss=2*torch.nn.functional.cross_entropy(h[0],y[:,0])
    loss+=torch.nn.functional.cross_entropy(h[1],y[:,1])
    loss+=torch.nn.functional.cross_entropy(h[2],y[:,2])
    target=y[:,1]>0
    if target.any():
        loss+=sum(torch.nn.functional.cross_entropy(h[j][target],y[target,j]) for j in (3,4,5))
    valued=(y[:,0]==0)|(y[:,0]==1)
    if valued.any():
        loss+=torch.nn.functional.cross_entropy(h[6][valued],y[valued,6])
    second=y[:,1]>1
    if second.any():
        loss+=sum(torch.nn.functional.cross_entropy(h[j][second],y[second,j]) for j in (7,8,9,10))
    return loss


def fit(model,train,dev,epochs,lr):
    opt=torch.optim.Adam(model.parameters(),lr=lr)
    best=None
    logs=[]
    for epoch in range(epochs):
        model.train()
        order=torch.randperm(len(train[1]))
        total=0.0
        for idx in order.split(64):
            opt.zero_grad()
            loss=neutral_objective(model(train[0][idx]),train[1][idx])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(),1)
            opt.step()
            total+=float(loss.detach())*len(idx)
        logs.append(total/len(order))
        model.eval()
        with torch.no_grad():
            logits=model(dev[0])
            dp=resolve(predict(logits),dev[2])
            dm=metrics(dp,dev[1],dev[2])
            score=selection_score(dm)
        if best is None or score>best["score"]:
            best={
                "score":score,
                "epoch":epoch+1,
                "state_dict":copy.deepcopy(model.state_dict()),
                "development":dm,
            }
    model.load_state_dict(best["state_dict"])
    return best,logs


def evaluate(model,data):
    model.eval()
    with torch.no_grad():
        logits=model(data[0])
        pred=resolve(predict(logits),data[2])
        base=metrics(pred,data[1],data[2])
        conf=confidence_rows(logits,pred)
        exact=exact_rows(pred,data[1])

        gold=data[1]
        target_mask=gold[:,1]>0
        predicted_target=pred[:,3:6]
        gold_target=gold[:,3:6]
        wrong_target=(target_mask & ~(predicted_target==gold_target).all(1))

        ood_index=7
        ood_gold=gold[:,0]==ood_index
        ood_false_commit=ood_gold & (pred[:,0]!=ood_index)

    gate=coverage_at_precision(conf,exact,.99)
    base["commit_curve_99"]=gate

    target_count=int(target_mask.sum())
    ood_count=int(ood_gold.sum())
    base["wrong_target_rate"]=(
        float(wrong_target.float().sum()/target_count)
        if target_count else None
    )
    base["ood_false_commit_rate"]=(
        float(ood_false_commit.float().sum()/ood_count)
        if ood_count else None
    )

    if gate["threshold"] is not None:
        committed=conf>=gate["threshold"]
        committed_target=committed & target_mask
        committed_ood=committed & ood_gold
        committed_target_count=int(committed_target.sum())
        committed_ood_count=int(committed_ood.sum())
        base["committed_wrong_target_rate"]=(
            float((wrong_target & committed).float().sum()/committed_target_count)
            if committed_target_count else None
        )
        base["committed_ood_false_commit_rate"]=(
            float((ood_false_commit & committed).float().sum()/committed_ood_count)
            if committed_ood_count else None
        )
    else:
        base["committed_wrong_target_rate"]=None
        base["committed_ood_false_commit_rate"]=None

    return base


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--graph",default="artifacts/flywire/connectome.json")
    p.add_argument("--epochs",type=int,default=30)
    p.add_argument("--seeds",nargs="+",type=int,default=[1783,2783,3783])
    p.add_argument("--learning-rate",type=float,default=.005)
    p.add_argument("--out",type=Path,default=Path("artifacts/flywire-decision-gate/report.json"))
    a=p.parse_args()

    torch.set_num_threads(2)
    graph=json.loads(Path(a.graph).read_text())
    assert graph["source_sha256"]==EXPECTED_SHA256
    assert digest(a.graph)==GRAPH_SHA

    data=corpus(augment=True)
    train,dev,sealed=[pack(data[k]) for k in ["train","test","sealed"]]

    report={
        "truth":"same_input_same_output_same_budget_flywire_decision_gate",
        "graph_sha256":GRAPH_SHA,
        "source_sha256":EXPECTED_SHA256,
        "epochs":a.epochs,
        "seeds":a.seeds,
        "limitations":[
            "No pretrained BERT/SLM comparison: this gate isolates bounded-kernel architecture.",
            "The sealed suite is small; 99%-precision coverage there is directional, not a production guarantee.",
            "Hashed text/state features are shared by all compared models and are not an open-language benchmark.",
            "Parameter matching is approximate and reported explicitly.",
        ],
        "runs":{},
    }

    for seed in a.seeds:
        models,budget=build_models(graph,None,seed)
        seed_row={"budget":budget,"models":{}}
        for name,model in models.items():
            torch.manual_seed(seed)
            best,losses=fit(model,train,dev,a.epochs,a.learning_rate)
            seed_row["models"][name]={
                "params":parameter_count(model),
                "selected_epoch":best["epoch"],
                "development":evaluate(model,dev),
                "sealed":evaluate(model,sealed),
                "cpu_latency":latency_ms(model,dev[0]),
                "loss":losses,
            }
        report["runs"][str(seed)]=seed_row

    report["decision_note"]=(
        "Promote FlyWire topology only if the real graph shows a reproducible "
        "Pareto advantage over rewired/disconnected and same-budget baselines. "
        "Otherwise keep it as research history and use the best bounded kernel."
    )
    a.out.parent.mkdir(parents=True,exist_ok=True)
    a.out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))


if __name__=="__main__":
    main()
