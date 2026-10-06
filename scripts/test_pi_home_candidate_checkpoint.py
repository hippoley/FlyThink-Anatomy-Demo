#!/usr/bin/env python3
import json,tempfile
from pathlib import Path
import torch
from train_pi_home_candidate_checkpoint import fit,evaluate,CandidateRankNet,assert_identity_isolation,train_fingerprint
from eval_pi_home_candidate_checkpoint import load_model,predict

data=json.loads(Path("benchmarks/pi_home_candidate_generalization.json").read_text(encoding="utf-8"))
isolation=assert_identity_isolation(data["train_cases"],data["cases"])
assert isolation["overlap"]==[]
assert isolation["train_candidate_identities"]>0
assert isolation["eval_candidate_identities"]>0
model,pairs=fit(data["train_cases"],epochs=300,seed=4517)
assert len(pairs)>=4
report=evaluate(model,data["cases"])
assert report["cases"]==2
assert report["exact"]==1.0,report

with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"model.pt"
    fingerprint=train_fingerprint(data["train_cases"])
    torch.save({
        "state_dict":model.state_dict(),
        "features":["noise_cost","ventilation_gain","rain_exposure","leeward_score"],
        "families":["quiet-ventilation","rain-safe-opening"],
        "schema_version":"pi-home-candidate-checkpoint-v1",
        "shadow_only":True,
        "train_fingerprint":fingerprint
    },p)
    loaded,meta=load_model(p,expected_train_fingerprint=fingerprint)
    assert meta["shadow_only"] is True
    for case in data["cases"]:
        ranking=predict(loaded,case)
        assert ranking
        assert ranking[0]["target"]==case["gold"]["expected_targets"][0]

    tampered=json.loads(json.dumps(data["train_cases"]))
    tampered[0]["context"]["candidates"][0]["features"]["noise_cost"]=0.12345
    try:
        load_model(p,expected_train_fingerprint=train_fingerprint(tampered))
        raise AssertionError("expected fingerprint mismatch")
    except ValueError as exc:
        assert "fingerprint mismatch" in str(exc)

print(json.dumps({
    "ok":True,
    "contract":"learned PyTorch candidate checkpoint transfers recovery preferences to unseen candidate sets",
    "holdout_exact":report["exact"],
    "shadow_only":True
}))
