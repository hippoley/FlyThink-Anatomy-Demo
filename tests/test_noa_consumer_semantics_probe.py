import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from noa_consumer_semantics_probe import (
    SOURCE_ABSENT,
    mutate_projection,
    project_source,
    validate_projection,
)


def receipt():
    return {
        "spec": "noa.receipt/0.1",
        "id": "rcpt_allowed_a",
        "action": {
            "id": "deploy.apply",
            "canonical": "deploy.apply:prod/api",
            "paramsHash": "sha256:" + "a" * 64,
        },
        "governance": {
            "verdict": "ALLOWED",
            "approval": {"by": "HUMAN:test", "at": "2026-07-14T11:55:00.000Z"},
        },
    }


def test_projection_preserves_distinct_action_semantics_and_absent_claims():
    out = project_source(receipt())
    assert out["action"]["id"] == "deploy.apply"
    assert out["action"]["canonical"] == "deploy.apply:prod/api"
    assert out["action"]["paramsHash"] == "sha256:" + "a" * 64
    assert out["outcome"] == "ALLOWED"
    assert out["controller_report"] == SOURCE_ABSENT
    assert out["physical_completion"] == SOURCE_ABSENT


def test_transposition_is_refused_even_though_both_fields_are_strings():
    expected = project_source(receipt())
    bad = mutate_projection(expected, {"kind": "transpose_action_fields"})
    out = validate_projection(receipt(), bad)
    assert out["status"] == "REFUSE"
    assert out["code"] == "action_id_mismatch"


def test_consumer_cannot_rederive_params_hash():
    bad = project_source(receipt())
    bad["action"]["paramsHash"] = "sha256:" + "b" * 64
    assert validate_projection(receipt(), bad)["code"] == "params_hash_mismatch"


def test_executed_or_allowed_source_does_not_create_physical_completion_claim():
    src = receipt()
    src["governance"]["verdict"] = "EXECUTED"
    expected = project_source(src)
    assert expected["physical_completion"] == SOURCE_ABSENT
    bad = copy.deepcopy(expected)
    bad["physical_completion"] = "VERIFIED"
    assert validate_projection(src, bad)["code"] == "physical_completion_must_be_source_absent"


def test_unknown_source_revision_fails_closed():
    src = receipt()
    src["spec"] = "noa.receipt/9"
    try:
        project_source(src)
    except ValueError as error:
        assert str(error) == "unsupported_source_revision"
    else:
        raise AssertionError("unknown revision accepted")
