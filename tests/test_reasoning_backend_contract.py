import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from reasoning_backend import (
    CONTEXT_STATE_VERSION,
    legacy_state_to_context_state,
    safe_for_commit,
    validate_context_state,
    validate_proposal_shape,
)


def test_valid_proposal_shape():
    proposal = {
        "operation": "revise",
        "frames": [{"area": "客厅", "entity": "主灯", "property": "power", "value": False}],
        "focus": "客厅::主灯",
        "ambiguity": [],
        "confidence": 0.92,
        "commit_recommendation": "PROPOSE",
        "reason": "resolved from persistent focus",
    }
    validate_proposal_shape(proposal)
    assert safe_for_commit(proposal) is True


def test_clarification_never_advises_commit():
    proposal = {
        "operation": "retain",
        "frames": [],
        "ambiguity": ["TARGET_AMBIGUITY"],
        "confidence": 0.4,
        "commit_recommendation": "CLARIFY",
        "reason": "multiple targets",
    }
    assert safe_for_commit(proposal) is False


def test_ambiguity_blocks_even_if_backend_says_propose():
    proposal = {
        "operation": "revise",
        "frames": [],
        "ambiguity": ["ROOM_AMBIGUITY"],
        "confidence": 0.8,
        "commit_recommendation": "PROPOSE",
        "reason": "backend is overconfident",
    }
    assert safe_for_commit(proposal) is False


def test_invalid_operation_rejected():
    proposal = {
        "operation": "execute",
        "frames": [],
        "ambiguity": [],
        "commit_recommendation": "PROPOSE",
    }
    try:
        validate_proposal_shape(proposal)
    except ValueError:
        return
    raise AssertionError("invalid operation should be rejected")


def test_context_state_contract_accepts_canonical_envelope():
    state = legacy_state_to_context_state({"focused": "legacy"})
    assert state["contract_version"] == CONTEXT_STATE_VERSION
    validate_context_state(state)


def test_context_state_contract_rejects_private_runtime_shape():
    try:
        validate_context_state({"devices": {}, "pending": {}})
    except ValueError as exc:
        assert "unsupported_context_state_contract" in str(exc)
        return
    raise AssertionError("private runtime shape must not cross reasoning boundary")


def test_context_state_contract_rejects_physical_id_in_logical_focus():
    state = legacy_state_to_context_state({})
    state["conversation"]["focused_target"] = {
        "area": "主卧",
        "entity": "空调",
        "instance": "default",
        "entity_id": "physical-123",
    }
    try:
        validate_context_state(state)
    except ValueError as exc:
        assert "logical_target_contract_violation" in str(exc)
        return
    raise AssertionError("physical ids must not enter semantic reasoning target")
