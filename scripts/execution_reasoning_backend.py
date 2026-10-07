#!/usr/bin/env python3
"""Execution-only reasoning contract for FlyThink.

Canonical language/context ownership is upstream. FlyThink consumes
contextual-state.v1 plus an already-resolved execution request and may only
select from explicit candidate actions. It never executes devices.
"""
from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional

from reasoning_backend import BackendConfig, validate_context_state

REQUEST_VERSION = "flythink-execution-request.v1"
PROPOSAL_VERSION = "flythink-execution-proposal.v1"
FORBIDDEN_SEMANTIC_KEYS = {
    "utterance", "text", "transcript", "frames", "focus", "ambiguity",
    "semantic_operation",
}
ALLOWED_ACTION_OPS = {
    "PATCH_SLOT", "PATCH_RELATIVE", "CLOSE_DEVICE",
    "ADD_DEVICE", "REMOVE_DEVICE", "REPLACE_TARGET",
}

SYSTEM_PROMPT = """You are an execution-reasoning backend for FlyThink.
Language understanding, reference resolution, dialogue state, and task state
have already been produced upstream. Do not reinterpret user speech.
Select only from request.candidate_actions. Never execute a device.
Return JSON with schema_version, task_id, decision, strategy, proposed_actions,
uncertainty, evidence_refs, and reason_code. Authorization remains external.
"""

def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def forbidden_semantic_paths(value: Any, path: str = "$") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if key in FORBIDDEN_SEMANTIC_KEYS:
                found.append(child_path)
            found.extend(forbidden_semantic_paths(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(forbidden_semantic_paths(child, f"{path}[{index}]"))
    return found

def reject_semantic_leak(value: Any, label: str) -> None:
    leaked = forbidden_semantic_paths(value)
    if leaked:
        raise ValueError(label + ":" + ",".join(leaked))

def logical_target(target: Any) -> bool:
    return (
        isinstance(target, dict)
        and set(target.keys()) == {"area", "entity", "instance"}
        and all(isinstance(target[k], str) and target[k] for k in ("area", "entity", "instance"))
    )

def validate_candidate_action(action: Dict[str, Any]) -> None:
    if not isinstance(action, dict):
        raise ValueError("candidate_action_must_be_object")
    if action.get("op") not in ALLOWED_ACTION_OPS:
        raise ValueError("candidate_action_op_invalid")
    reject_semantic_leak(action, "semantic_input_forbidden")
    if action["op"] == "REPLACE_TARGET":
        if not logical_target(action.get("from")) or not logical_target(action.get("to")):
            raise ValueError("logical_target_contract_violation")
    elif not logical_target(action.get("target")):
        raise ValueError("logical_target_contract_violation")

def validate_execution_request(request: Dict[str, Any]) -> None:
    if not isinstance(request, dict):
        raise ValueError("execution_request_must_be_object")
    if request.get("request_version") != REQUEST_VERSION:
        raise ValueError("unsupported_execution_request_contract")
    reject_semantic_leak(request, "semantic_input_forbidden")
    if not isinstance(request.get("task_id"), str) or not request["task_id"]:
        raise ValueError("execution_task_id_required")
    if not isinstance(request.get("goal"), dict):
        raise ValueError("execution_goal_must_be_structured_object")
    targets = request.get("resolved_targets")
    if not isinstance(targets, list):
        raise ValueError("resolved_targets_must_be_list")
    for target in targets:
        if not logical_target(target):
            raise ValueError("logical_target_contract_violation")
    resolved = {canonical(target) for target in targets}
    candidates = request.get("candidate_actions")
    if not isinstance(candidates, list):
        raise ValueError("candidate_actions_must_be_list")
    seen_candidates = set()
    for action in candidates:
        validate_candidate_action(action)
        action_targets = (
            [action["from"], action["to"]]
            if action["op"] == "REPLACE_TARGET"
            else [action["target"]]
        )
        for action_target in action_targets:
            if canonical(action_target) not in resolved:
                raise ValueError("candidate_action_target_not_resolved")
        action_id = canonical(action)
        if action_id in seen_candidates:
            raise ValueError("duplicate_candidate_action")
        seen_candidates.add(action_id)
    if not isinstance(request.get("constraints", []), list):
        raise ValueError("execution_constraints_must_be_list")

def validate_execution_proposal(
    proposal: Dict[str, Any],
    *,
    request: Optional[Dict[str, Any]] = None,
) -> None:
    if not isinstance(proposal, dict):
        raise ValueError("execution_proposal_must_be_object")
    if proposal.get("schema_version") != PROPOSAL_VERSION:
        raise ValueError("unsupported_execution_proposal_contract")
    reject_semantic_leak(proposal, "semantic_output_forbidden")
    if proposal.get("decision") not in {"PROPOSE", "DEFER", "BLOCK"}:
        raise ValueError("execution_decision_invalid")
    if not isinstance(proposal.get("task_id"), str) or not proposal["task_id"]:
        raise ValueError("execution_proposal_task_id_required")
    actions = proposal.get("proposed_actions")
    if not isinstance(actions, list):
        raise ValueError("proposed_actions_must_be_list")
    for action in actions:
        validate_candidate_action(action)
    uncertainty = proposal.get("uncertainty")
    if not isinstance(uncertainty, dict):
        raise ValueError("execution_uncertainty_required")
    score = uncertainty.get("score")
    if not isinstance(score, (int, float)) or not 0 <= score <= 1:
        raise ValueError("execution_uncertainty_score_invalid")
    reasons = uncertainty.get("reasons")
    if not isinstance(reasons, list) or not all(isinstance(x, str) for x in reasons):
        raise ValueError("execution_uncertainty_reasons_invalid")
    if proposal["decision"] == "PROPOSE" and not actions:
        raise ValueError("propose_requires_action")
    if proposal["decision"] != "PROPOSE" and actions:
        raise ValueError("non_propose_decision_must_not_emit_actions")
    evidence_refs = proposal.get("evidence_refs", [])
    if not isinstance(evidence_refs, list) or not all(
        isinstance(x, str) for x in evidence_refs
    ):
        raise ValueError("execution_evidence_refs_invalid")
    if request is not None:
        validate_execution_request(request)
        if proposal["task_id"] != request["task_id"]:
            raise ValueError("execution_proposal_task_mismatch")
        allowed = {canonical(x) for x in request["candidate_actions"]}
        seen_actions = set()
        for action in actions:
            action_id = canonical(action)
            if action_id not in allowed:
                raise ValueError("execution_action_not_in_candidate_set")
            if action_id in seen_actions:
                raise ValueError("duplicate_proposed_action")
            seen_actions.add(action_id)

def advisory_safe_for_authorization(
    proposal: Dict[str, Any],
    *,
    request: Dict[str, Any],
    max_uncertainty: float = 0.35,
) -> bool:
    """Advisory only; deterministic FlyThink authorization remains authoritative."""
    validate_execution_proposal(proposal, request=request)
    return (
        proposal["decision"] == "PROPOSE"
        and bool(proposal["proposed_actions"])
        and proposal["uncertainty"]["score"] <= max_uncertainty
    )

class ExecutionReasoningBackend:
    def propose(
        self,
        *,
        contextual_state: Dict[str, Any],
        request: Dict[str, Any],
    ) -> Dict[str, Any]:
        raise NotImplementedError

@dataclass
class OpenAICompatibleExecutionBackend(ExecutionReasoningBackend):
    config: BackendConfig

    def propose(
        self,
        *,
        contextual_state: Dict[str, Any],
        request: Dict[str, Any],
    ) -> Dict[str, Any]:
        validate_context_state(contextual_state)
        validate_execution_request(request)
        payload = {
            "model": self.config.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps({
                    "contextual_state": contextual_state,
                    "request": request,
                }, ensure_ascii=False)},
            ],
        }
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        req = urllib.request.Request(
            f"{self.config.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.config.timeout_seconds) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        text = raw["choices"][0]["message"]["content"].strip()
        if text.startswith("```"):
            lines = text.splitlines()[1:]
            if lines and lines[-1].strip().startswith("```"):
                lines = lines[:-1]
            text = chr(10).join(lines).strip()
        proposal = json.loads(text)
        validate_execution_proposal(proposal, request=request)
        return proposal

class RuleExecutionBackend(ExecutionReasoningBackend):
    """Deterministic baseline for backend A/B tests."""

    def __init__(self, selector=None):
        self.selector = selector or (lambda request: list(request["candidate_actions"][:1]))

    def propose(
        self,
        *,
        contextual_state: Dict[str, Any],
        request: Dict[str, Any],
    ) -> Dict[str, Any]:
        validate_context_state(contextual_state)
        validate_execution_request(request)
        actions = list(self.selector(request) or [])
        proposal = {
            "schema_version": PROPOSAL_VERSION,
            "task_id": request["task_id"],
            "decision": "PROPOSE" if actions else "DEFER",
            "strategy": {"backend": "rule-baseline"} if actions else None,
            "proposed_actions": actions,
            "uncertainty": {
                "score": 0.0 if actions else 1.0,
                "reasons": [] if actions else ["NO_CANDIDATE_SELECTED"],
            },
            "evidence_refs": [],
            "reason_code": (
                "RULE_CANDIDATE_SELECTED" if actions else "NO_CANDIDATE_SELECTED"
            ),
        }
        validate_execution_proposal(proposal, request=request)
        return proposal
