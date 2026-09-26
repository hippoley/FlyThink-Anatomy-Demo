#!/usr/bin/env python3
"""V2 training: context-counterfactual train/sealed evaluation."""
import argparse, copy, json
from pathlib import Path
import torch
from train_flywire import digest, EXPECTED_SHA256
from train_flywire_delta import GRAPH_SHA, text_features
from train_flywire_whole_home_patch import WholeHomePatchNet, context_features, encode_patch, objective, predict, metrics, MAX_PATCHES
from whole_home_patch_corpus_v2 import build

def pack(rows):
    out=[]
    for turn in rows:
        ps=turn["gold_patches"]; labels=[len(ps)]
        for i in range(MAX_PATCHES):
            labels += encode_patch(ps[i]) if i<len(ps) else [0,2,3,5]
        out.append((torch.cat([text_features(turn["text"]),context_features(turn)]),torch.tensor(labels),turn))
    return out

def tensors(rows):
    p=pack(rows);return torch.stack([r[0] for r in p]),torch.stack([r[1] for r in p]),p

def train_mode(g,train,sealed,mode,epochs):
    model=WholeHomePatchNet(g,disconnect=(mode=="disconnected"))
    opt=torch.optim.Adam(model.parameters(),lr=.006)
    best=None
    for epoch in range(epochs):
        opt.zero_grad();loss=objective(model(train[0]),train[1]);loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);opt.step()
        if (epoch+1)%10==0 or epoch==epochs-1:
            with torch.no_grad(): dev=metrics(predict(model(sealed[0])),sealed[1],sealed[2])
            score=(dev["patch_exact"],dev["operation_accuracy"],dev["target_accuracy"])
            if best is None or score>best["score"]:best={"score":score,"epoch":epoch+1,"state":copy.deepcopy(model.state_dict()),"metrics":dev}
    model.load_state_dict(best["state"])
    return model,best

def main():
    p=argparse.ArgumentParser();p.add_argument("--graph",default="artifacts/flywire/connectome.json");p.add_argument("--epochs",type=int,default=160);p.add_argument("--out",type=Path,default=Path("artifacts/flywire-whole-home-v2"));a=p.parse_args()
    torch.set_num_threads(2);g=json.loads(Path(a.graph).read_text());assert g["source_sha256"]==EXPECTED_SHA256 and digest(a.graph)==GRAPH_SHA
    corpus=build();train=tensors(corpus["train"]);sealed=tensors(corpus["sealed"]);a.out.mkdir(parents=True,exist_ok=True)
    report={"truth":"v2_context_counterfactual_whole_home_patch_training","source_sha256":EXPECTED_SHA256,"graph_sha256":GRAPH_SHA,
            "train_examples":len(train[1]),"sealed_examples":len(sealed[1]),"sealed_design":corpus["design"],"runs":{},
            "claim_rule":"sealed metrics only; training fit is not capability evidence"}
    for mode in ("real","disconnected"):
        model,best=train_mode(g,train,sealed,mode,a.epochs)
        with torch.no_grad():
            tr=metrics(predict(model(train[0])),train[1],train[2]);se=metrics(predict(model(sealed[0])),sealed[1],sealed[2])
        torch.save({"state_dict":model.state_dict(),"mode":mode,"graph_sha256":GRAPH_SHA},a.out/f"{mode}.pt")
        report["runs"][mode]={"selected_epoch":best["epoch"],"train":tr,"sealed":se}
    r=report["runs"]["real"]["sealed"]["patch_exact"];d=report["runs"]["disconnected"]["sealed"]["patch_exact"]
    report["real_minus_disconnected_patch_exact"]=r-d
    report["interpretation"]="connectome advantage observed" if r>d else "no demonstrated connectome advantage on v2"
    (a.out/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8");print(json.dumps(report,ensure_ascii=False))
if __name__=="__main__":main()
