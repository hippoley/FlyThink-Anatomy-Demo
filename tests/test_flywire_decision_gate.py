import json
from pathlib import Path

import torch

from scripts.benchmark_flywire_decision_gate import (
    OUT_DIM,
    build_models,
    coverage_at_precision,
    fixed_threshold_result,
    parameter_count,
    split_development_dialogues,
)
from scripts.train_flywire import EXPECTED_SHA256, digest
from scripts.train_flywire_delta import GRAPH_SHA, TEXT_DIM, STATE_DIM


def load_graph():
    path=Path("artifacts/flywire/connectome.json")
    graph=json.loads(path.read_text(encoding="utf-8"))
    assert graph["source_sha256"]==EXPECTED_SHA256
    assert digest(path)==GRAPH_SHA
    return graph


def test_same_budget_models_share_input_and_output_contract():
    graph=load_graph()
    models,budget=build_models(graph,None,1783)
    x=torch.zeros(2,TEXT_DIM*3+STATE_DIM)
    target=budget["target_params"]

    assert set(models)=={
        "flywire-real",
        "flywire-rewired",
        "flywire-disconnected",
        "mlp",
        "gru",
        "tiny-transformer",
    }

    for name,model in models.items():
        out=model(x)
        assert tuple(out.shape)==(2,OUT_DIM), name

    assert parameter_count(models["flywire-real"])==parameter_count(models["flywire-rewired"])

    for name in ("mlp","gru","tiny-transformer"):
        count=parameter_count(models[name])
        assert abs(count-target)/target <= 0.10, (name,count,target)


def test_disconnected_control_has_no_recurrent_connectome_effect():
    graph=load_graph()
    models,_=build_models(graph,None,1783)
    x=torch.randn(4,TEXT_DIM*3+STATE_DIM)

    model=models["flywire-disconnected"]
    with torch.no_grad():
        a=model(x)
        b=model(x,disconnect=True)
    torch.testing.assert_close(a,b)


def test_commit_curve_never_splits_equal_confidence_ties():
    confidence=torch.tensor([0.9,0.9,0.8])
    exact=torch.tensor([True,False,True])
    gate=coverage_at_precision(confidence,exact,target=0.99)
    # No scalar threshold can keep only the correct 0.9 sample.
    assert gate["coverage"]==0.0
    assert gate["committed"]==0


def test_commit_curve_reports_largest_real_threshold_group():
    confidence=torch.tensor([0.99,0.95,0.95,0.5])
    exact=torch.tensor([True,True,True,False])
    gate=coverage_at_precision(confidence,exact,target=0.99)
    assert gate["coverage"]==0.75
    assert gate["precision"]==1.0
    assert gate["threshold"]==0.95


def test_sealed_evaluation_uses_fixed_development_threshold():
    confidence=torch.tensor([0.99,0.80,0.79])
    exact=torch.tensor([True,False,True])
    result=fixed_threshold_result(confidence,exact,threshold=0.80)
    assert result["threshold"]==0.80
    assert result["committed"]==2
    assert result["precision"]==0.5
    # The helper must report reality at the supplied threshold; it must not
    # re-select 0.99 just because that would look better on this split.
    assert result["coverage"]==2/3


def test_development_split_keeps_whole_dialogues_disjoint():
    x=torch.arange(40).reshape(20,2).float()
    y=torch.arange(20).reshape(20,1)
    rows=[{"id":i} for i in range(20)]
    selection,calibration=split_development_dialogues(
        (x,y,rows),turns_per_dialogue=5
    )
    selection_ids={r["id"] for r in selection[2]}
    calibration_ids={r["id"] for r in calibration[2]}
    assert selection_ids.isdisjoint(calibration_ids)
    assert selection_ids==set(range(0,5))|set(range(10,15))
    assert calibration_ids==set(range(5,10))|set(range(15,20))
