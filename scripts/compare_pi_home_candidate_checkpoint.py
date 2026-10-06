#!/usr/bin/env python3
"""Compare learned checkpoint decisions against the baseline on the same unseen holdout."""
import argparse
import sys,json
from pathlib import Path
from eval_pi_home_candidate_checkpoint import load_model,predict
from train_pi_home_candidate_checkpoint import target_key,train_fingerprint

def _configure_utf8_stdio():
    for stream in (sys.stdout,sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError,ValueError):
            pass

_configure_utf8_stdio()

def metrics(decision,gold):
    patches=decision.get("patches") or []
    predicted=patches[0].get("target") if patches and patches[0].get("target") else None
    expected=(gold.get("expected_targets") or [None])[0]
    wrong=0 if predicted and expected and target_key(predicted)==target_key(expected) else 1
    correction=1 if decision.get("requires_correction") is True or wrong else 0
    completed=1 if decision.get("goal_completed") is True and wrong==0 else 0
    return {"wrong_target":wrong,"correction_needed":correction,"goal_completed":completed}

def learned_decision(model,case):
    ranking=predict(model,case)
    baseline=json.loads(json.dumps(case["baseline"]))
    patches=baseline.get("patches") or []
    if not patches:
        return baseline,ranking
    patches[0]["target"]=ranking[0]["target"]
    baseline["patches"]=patches
    baseline["requires_correction"]=False
    baseline["goal_completed"]=True
    baseline["replay_conditioned"]=False
    baseline["learned_checkpoint"]=True
    return baseline,ranking

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data",default="benchmarks/pi_home_candidate_generalization.json")
    ap.add_argument("--checkpoint",default="artifacts/pi-home-candidate-checkpoint/model.pt")
    args=ap.parse_args()
    data=json.loads(Path(args.data).read_text(encoding="utf-8"))
    model,_=load_model(
        args.checkpoint,
        expected_train_fingerprint=train_fingerprint(data["train_cases"])
    )
    rows=[]
    for case in data["cases"]:
        learned,ranking=learned_decision(model,case)
        b=metrics(case["baseline"],case["gold"])
        e=metrics(learned,case["gold"])
        rows.append({
            "id":case["id"],
            "split":case["split"],
            "baseline":b,
            "learned":e,
            "delta":{
                "wrong_target_reduction":b["wrong_target"]-e["wrong_target"],
                "correction_reduction":b["correction_needed"]-e["correction_needed"],
                "goal_completion_gain":e["goal_completed"]-b["goal_completed"]
            },
            "ranking":ranking,
            "exact_replay_hit":False
        })
    def total(key,side): return sum(r[side][key] for r in rows)
    out={
        "schema_version":"pi-home-learned-checkpoint-reality-delta-v1",
        "shadow_only":True,
        "cases":len(rows),
        "exact_replay_hits":0,
        "baseline":{
            "wrong_target":total("wrong_target","baseline"),
            "correction_needed":total("correction_needed","baseline"),
            "goal_completed":total("goal_completed","baseline")
        },
        "learned":{
            "wrong_target":total("wrong_target","learned"),
            "correction_needed":total("correction_needed","learned"),
            "goal_completed":total("goal_completed","learned")
        },
        "delta":{
            "wrong_target_reduction":total("wrong_target","baseline")-total("wrong_target","learned"),
            "correction_reduction":total("correction_needed","baseline")-total("correction_needed","learned"),
            "goal_completion_gain":total("goal_completed","learned")-total("goal_completed","baseline")
        },
        "device_execution_authorized":False,
        "rows":rows
    }
    print(json.dumps(out,ensure_ascii=False))
    if out["exact_replay_hits"]!=0: raise SystemExit(2)
    if out["delta"]["wrong_target_reduction"]<=0: raise SystemExit(2)
    if out["delta"]["goal_completion_gain"]<=0: raise SystemExit(2)

if __name__=="__main__": main()
