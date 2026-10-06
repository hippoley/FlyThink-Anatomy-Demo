#!/usr/bin/env python3
import json,tempfile
from pathlib import Path
import torch
from train_pi_home_candidate_checkpoint import fit
from compare_pi_home_candidate_checkpoint import learned_decision,metrics
from eval_pi_home_candidate_checkpoint import load_model

data=json.loads(Path("benchmarks/pi_home_candidate_generalization.json").read_text())
model,_=fit(data["train_cases"],epochs=300,seed=4517)
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"model.pt"
    torch.save({
        "state_dict":model.state_dict(),
        "features":["noise_cost","ventilation_gain","rain_exposure","leeward_score"],
        "families":["quiet-ventilation","rain-safe-opening"],
        "schema_version":"pi-home-candidate-checkpoint-v1",
        "shadow_only":True
    },p)
    loaded,_=load_model(p)
    gains=[]
    for case in data["cases"]:
        learned,_=learned_decision(loaded,case)
        b=metrics(case["baseline"],case["gold"])
        e=metrics(learned,case["gold"])
        gains.append((b["wrong_target"]-e["wrong_target"],e["goal_completed"]-b["goal_completed"]))
    assert all(x[0]>=0 and x[1]>=0 for x in gains)
    assert sum(x[0] for x in gains)>0
    assert sum(x[1] for x in gains)>0

print(json.dumps({
    "ok":True,
    "contract":"learned checkpoint must beat baseline on unseen holdout under the same Reality Delta metrics"
}))
