#!/usr/bin/env python3
"""Load the learned candidate ranking checkpoint and evaluate without training-time gold access."""
import argparse
import sys,json
from pathlib import Path
import torch
from train_pi_home_candidate_checkpoint import CandidateRankNet,row_vector,target_key,train_fingerprint

def _configure_utf8_stdio():
    for stream in (sys.stdout,sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError,ValueError):
            pass

_configure_utf8_stdio()

def load_model(path,expected_train_fingerprint=None):
    ckpt=torch.load(path,map_location="cpu",weights_only=True)
    if ckpt.get("schema_version")!="pi-home-candidate-checkpoint-v1":
        raise ValueError("unsupported candidate checkpoint schema")
    if ckpt.get("shadow_only") is not True:
        raise ValueError("candidate checkpoint must remain shadow-only")
    if expected_train_fingerprint is not None and ckpt.get("train_fingerprint")!=expected_train_fingerprint:
        raise ValueError("candidate checkpoint training fingerprint mismatch")
    model=CandidateRankNet(); model.load_state_dict(ckpt["state_dict"]); model.eval()
    return model,ckpt

def predict(model,case):
    family=case["context"]["intent_family"]
    rows=[]
    with torch.no_grad():
        for cand in case["context"]["candidates"]:
            score=float(model(row_vector(family,cand).unsqueeze(0))[0])
            rows.append({"target":cand["target"],"score":score})
    rows.sort(key=lambda x:(-x["score"],target_key(x["target"])))
    return rows

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data",default="benchmarks/pi_home_candidate_generalization.json")
    ap.add_argument("--checkpoint",default="artifacts/pi-home-candidate-checkpoint/model.pt")
    args=ap.parse_args()
    data=json.loads(Path(args.data).read_text(encoding="utf-8"))
    expected=train_fingerprint(data["train_cases"])
    model,ckpt=load_model(args.checkpoint,expected_train_fingerprint=expected)
    rows=[];correct=0
    for case in data["cases"]:
        ranking=predict(model,case)
        predicted=ranking[0]["target"]
        gold=case["gold"]["expected_targets"][0]
        ok=target_key(predicted)==target_key(gold)
        correct+=int(ok)
        rows.append({
            "id":case["id"],
            "split":case["split"],
            "predicted":predicted,
            "gold":gold,
            "correct":ok,
            "ranking":ranking,
            "exact_replay_hit":False
        })
    out={
        "schema_version":"pi-home-learned-checkpoint-shadow-eval-v1",
        "shadow_only":True,
        "cases":len(rows),
        "exact":correct/len(rows) if rows else 0.0,
        "exact_replay_hits":0,
        "device_execution_authorized":False,
        "rows":rows
    }
    print(json.dumps(out,ensure_ascii=False))
    if out["exact_replay_hits"]!=0: raise SystemExit(2)
    if out["exact"]<1.0: raise SystemExit(2)

if __name__=="__main__": main()
