import sys\nfrom pathlib import Path\n\nsys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))\n\nfrom execution_reasoning_backend import (\n    PROPOSAL_VERSION,\n    REQUEST_VERSION,\n    RuleExecutionBackend,\n    advisory_safe_for_authorization,\n    validate_execution_proposal,\n    validate_execution_request,\n)\nfrom reasoning_backend import legacy_state_to_context_state\n\nSTATE = legacy_state_to_context_state({})\nSTATE["world"]["devices"] = {\n    "客厅::窗::default": {\n        "target": {"area": "客厅", "entity": "窗", "instance": "default"},\n        "slots": {"opening": 20},\n    }\n}\nTARGET = {"area": "客厅", "entity": "窗", "instance": "default"}\nACTION = {\n    "op": "PATCH_SLOT",\n    "target": TARGET,\n    "slot": "opening",\n    "value": 40,\n}\nREQUEST = {\n    "request_version": REQUEST_VERSION,\n    "task_id": "task-001",\n    "goal": {"type": "desired_state", "metric": "comfort"},\n    "resolved_targets": [TARGET],\n    "constraints": [{"type": "max_opening", "value": 50}],\n    "candidate_actions": [ACTION],\n}\n\ndef test_execution_request_is_structured_not_utterance_driven():\n    validate_execution_request(REQUEST)\n    leaked = dict(REQUEST)\n    leaked["utterance"] = "这里有点闷"\n    try:\n        validate_execution_request(leaked)\n    except ValueError as exc:\n        assert "semantic_input_forbidden" in str(exc)\n        return\n    raise AssertionError("raw utterance must not cross execution reasoning boundary")\n\ndef test_rule_backend_selects_only_explicit_candidate():\n    proposal = RuleExecutionBackend().propose(\n        contextual_state=STATE,\n        request=REQUEST,\n    )\n    assert proposal["schema_version"] == PROPOSAL_VERSION\n    assert proposal["decision"] == "PROPOSE"\n    assert proposal["proposed_actions"] == [ACTION]\n    assert advisory_safe_for_authorization(proposal, request=REQUEST) is True\n\ndef test_backend_cannot_invent_target_or_value():\n    invented = {\n        "schema_version": PROPOSAL_VERSION,\n        "task_id": "task-001",\n        "decision": "PROPOSE",\n        "strategy": {},\n        "proposed_actions": [{\n            "op": "PATCH_SLOT",\n            "target": {"area": "卧室", "entity": "窗", "instance": "default"},\n            "slot": "opening",\n            "value": 100,\n        }],\n        "uncertainty": {"score": 0.1, "reasons": []},\n        "evidence_refs": [],\n        "reason_code": "MODEL_GUESSED",\n    }\n    try:\n        validate_execution_proposal(invented, request=REQUEST)\n    except ValueError as exc:\n        assert "execution_action_not_in_candidate_set" in str(exc)\n        return\n    raise AssertionError("reasoner must not invent candidate actions")\n\ndef test_defer_cannot_smuggle_actions():\n    invalid = {\n        "schema_version": PROPOSAL_VERSION,\n        "task_id": "task-001",\n        "decision": "DEFER",\n        "strategy": None,\n        "proposed_actions": [ACTION],\n        "uncertainty": {"score": 0.9, "reasons": ["INSUFFICIENT_EVIDENCE"]},\n        "evidence_refs": [],\n        "reason_code": "DEFER",\n    }\n    try:\n        validate_execution_proposal(invalid, request=REQUEST)\n    except ValueError as exc:\n        assert "non_propose_decision_must_not_emit_actions" in str(exc)\n        return\n    raise AssertionError("DEFER must not emit actions")\n\ndef test_semantic_frames_cannot_reenter_execution_proposal():\n    invalid = {\n        "schema_version": PROPOSAL_VERSION,\n        "task_id": "task-001",\n        "decision": "BLOCK",\n        "strategy": None,\n        "proposed_actions": [],\n        "uncertainty": {"score": 1.0, "reasons": ["UPSTREAM_AMBIGUITY"]},\n        "evidence_refs": [],\n        "reason_code": "UPSTREAM_AMBIGUITY",\n        "frames": [{"area": "客厅"}],\n    }\n    try:\n        validate_execution_proposal(invalid, request=REQUEST)\n    except ValueError as exc:\n        assert "semantic_output_forbidden" in str(exc)\n        return\n    raise AssertionError("semantic frames must not reenter execution backend")\n

def test_nested_semantic_input_is_rejected():
    leaked = dict(REQUEST)
    leaked["goal"] = {
        "type": "desired_state",
        "utterance": "这里有点闷",
    }
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
