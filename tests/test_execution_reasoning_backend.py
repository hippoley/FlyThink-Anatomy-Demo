import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from execution_reasoning_backend import (
    PROPOSAL_VERSION,
    REQUEST_VERSION,
    RuleExecutionBackend,
    advisory_safe_for_authorization,
    validate_execution_proposal,
    validate_execution_request,
)
from reasoning_backend import legacy_state_to_context_state

STATE = legacy_state_to_context_state({})
STATE["world"]["devices"] = {
    "客厅::窗::default": {
        "target": {"area": "客厅", "entity": "窗", "instance": "default"},
        "slots": {"opening": 20},
    }
}
TARGET = {"area": "客厅", "entity": "窗", "instance": "default"}
ACTION = {
    "op": "PATCH_SLOT",
    "target": TARGET,
    "slot": "opening",
    "value": 40,
}
REQUEST = {
    "request_version": REQUEST_VERSION,
    "task_id": "task-001",
    "goal": {"type": "desired_state", "metric": "comfort"},
    "resolved_targets": [TARGET],
    "constraints": [{"type": "max_opening", "value": 50}],
    "candidate_actions": [ACTION],
}

def test_execution_request_is_structured_not_utterance_driven():
    validate_execution_request(REQUEST)
    leaked = dict(REQUEST)
    leaked["utterance"] = "这里有点闷"
    try:
        validate_execution_request(leaked)
    except ValueError as exc:
        assert "semantic_input_forbidden" in str(exc)
        return
    raise AssertionError("raw utterance must not cross execution reasoning boundary")

def test_rule_backend_selects_only_explicit_candidate():
    proposal = RuleExecutionBackend().propose(contextual_state=STATE, request=REQUEST)
    assert proposal["schema_version"] == PROPOSAL_VERSION
    assert proposal["decision"] == "PROPOSE"
    assert proposal["proposed_actions"] == [ACTION]
    assert advisory_safe_for_authorization(proposal, request=REQUEST) is True

def test_backend_cannot_invent_target_or_value():
    invented = {
        "schema_version": PROPOSAL_VERSION,
        "task_id": "task-001",
        "decision": "PROPOSE",
        "strategy": {},
        "proposed_actions": [{
            "op": "PATCH_SLOT",
            "target": {"area": "卧室", "entity": "窗", "instance": "default"},
            "slot": "opening",
            "value": 100,
        }],
        "uncertainty": {"score": 0.1, "reasons": []},
        "evidence_refs": [],
        "reason_code": "MODEL_GUESSED",
    }
    try:
        validate_execution_proposal(invented, request=REQUEST)
    except ValueError as exc:
        assert "execution_action_not_in_candidate_set" in str(exc)
        return
    raise AssertionError("reasoner must not invent candidate actions")

def test_defer_cannot_smuggle_actions():
    invalid = {
        "schema_version": PROPOSAL_VERSION,
        "task_id": "task-001",
        "decision": "DEFER",
        "strategy": None,
        "proposed_actions": [ACTION],
        "uncertainty": {"score": 0.9, "reasons": ["INSUFFICIENT_EVIDENCE"]},
        "evidence_refs": [],
        "reason_code": "DEFER",
    }
    try:
        validate_execution_proposal(invalid, request=REQUEST)
    except ValueError as exc:
        assert "non_propose_decision_must_not_emit_actions" in str(exc)
        return
    raise AssertionError("DEFER must not emit actions")

def test_semantic_frames_cannot_reenter_execution_proposal():
    invalid = {
        "schema_version": PROPOSAL_VERSION,
        "task_id": "task-001",
        "decision": "BLOCK",
        "strategy": None,
        "proposed_actions": [],
        "uncertainty": {"score": 1.0, "reasons": ["UPSTREAM_AMBIGUITY"]},
        "evidence_refs": [],
        "reason_code": "UPSTREAM_AMBIGUITY",
        "frames": [{"area": "客厅"}],
    }
    try:
        validate_execution_proposal(invalid, request=REQUEST)
    except ValueError as exc:
        assert "semantic_output_forbidden" in str(exc)
        return
    raise AssertionError("semantic frames must not reenter execution backend")

def test_nested_semantic_input_is_rejected():
    leaked = dict(REQUEST)
    leaked["goal"] = {"type": "desired_state", "utterance": "这里有点闷"}
    try:
        validate_execution_request(leaked)
    except ValueError as exc:
        assert "semantic_input_forbidden" in str(exc)
        assert "$.goal.utterance" in str(exc)
        return
    raise AssertionError("nested raw utterance must not cross execution boundary")

def test_nested_semantic_output_is_rejected():
    invalid = {
        "schema_version": PROPOSAL_VERSION,
        "task_id": "task-001",
        "decision": "BLOCK",
        "strategy": {"frames": [{"area": "客厅"}]},
        "proposed_actions": [],
        "uncertainty": {"score": 1.0, "reasons": ["UPSTREAM_AMBIGUITY"]},
        "evidence_refs": [],
        "reason_code": "UPSTREAM_AMBIGUITY",
    }
    try:
        validate_execution_proposal(invalid, request=REQUEST)
    except ValueError as exc:
        assert "semantic_output_forbidden" in str(exc)
        assert "$.strategy.frames" in str(exc)
        return
    raise AssertionError("nested semantic frames must not reenter FlyThink")

def test_candidate_action_target_must_be_resolved():
    bad = dict(REQUEST)
    bad["candidate_actions"] = [{
        "op": "PATCH_SLOT",
        "target": {"area": "卧室", "entity": "窗", "instance": "default"},
        "slot": "opening",
        "value": 20,
    }]
    try:
        validate_execution_request(bad)
    except ValueError as exc:
        assert "candidate_action_target_not_resolved" in str(exc)
        return
    raise AssertionError("candidate actions must stay inside resolved targets")


def _set_fixture_path(root, path_text, value):
    import copy
    parts = path_text.split(".")
    cur = root
    for part in parts[:-1]:
        cur = cur[int(part)] if part.isdigit() else cur[part]
    last = parts[-1]
    cur[int(last) if last.isdigit() else last] = copy.deepcopy(value)


def _build_fixture_case(fixture, row):
    import copy
    request = copy.deepcopy(fixture["base"]["request"])
    proposal = copy.deepcopy(fixture["base"]["proposal"])
    target = request if row["kind"] == "request" else proposal
    for mutation in row.get("mutations", []):
        _set_fixture_path(target, mutation["path"], mutation["value"])
    if row.get("append_candidate_from") is not None:
        request["candidate_actions"].append(
            copy.deepcopy(request["candidate_actions"][row["append_candidate_from"]])
        )
    if row.get("extra_candidate") is not None:
        request["candidate_actions"].append(copy.deepcopy(row["extra_candidate"]))
        if row.get("append_extra_proposed"):
            proposal["proposed_actions"].append(copy.deepcopy(row["extra_candidate"]))
    if row.get("append_proposed_from") is not None:
        proposal["proposed_actions"].append(
            copy.deepcopy(proposal["proposed_actions"][row["append_proposed_from"]])
        )
    return request, proposal


def test_shared_execution_contract_fixture():
    import json
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "benchmarks"
        / "execution_reasoning_contract_cases.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert fixture["schema_version"] == "flythink-execution-contract-cases-v1"

    for row in fixture["cases"]:
        request, proposal = _build_fixture_case(fixture, row)
        try:
            if row["kind"] == "request":
                validate_execution_request(request)
            else:
                validate_execution_proposal(proposal, request=request)
            error = None
        except ValueError as exc:
            error = str(exc)

        if row.get("expect") == "PASS":
            assert error is None, f'{row["id"]}: {error}'
        else:
            assert error is not None, f'{row["id"]}: expected error'
            assert row["expect_error"] in error, (
                f'{row["id"]}: expected {row["expect_error"]}, got {error}'
            )
