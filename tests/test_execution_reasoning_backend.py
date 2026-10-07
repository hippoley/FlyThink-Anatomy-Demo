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
