#!/usr/bin/env python3
"""Pluggable reasoning backends for FlyThink.

Backends may propose semantic state, but they never execute a Thing Model action.
Every proposal must still pass FlyThink's deterministic ambiguity, capability,
policy and commit gates.

Supported endpoints are OpenAI-compatible so the same adapter can target:
- a local vLLM/SGLang/llama.cpp server (for example Muse Glimmer locally)
- Meta Model API (Muse Spark)
- other compatible development backends

No provider SDK is required.
"""
from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional


PROPOSAL_SCHEMA = {
    "type": "object",
    "required": ["operation", "frames", "commit_recommendation"],
    "properties": {
        "operation": {"enum": ["retain", "add", "revise", "retract", "clear", "ood"]},
        "frames": {"type": "array"},
        "focus": {"type": ["string", "null"]},
        "ambiguity": {"type": "array"},
        "confidence": {"type": "number"},
        "commit_recommendation": {"enum": ["PROPOSE", "CLARIFY", "BLOCK"]},
        "reason": {"type": "string"},
    },
}


SYSTEM_PROMPT = """You are a semantic proposal engine for a home-control runtime.
You are NOT allowed to execute devices.

Return exactly one JSON object with:
operation: retain|add|revise|retract|clear|ood
frames: list of independent room/device/property proposals
focus: nullable stable frame reference
ambiguity: list of unresolved ambiguity labels
confidence: 0..1
commit_recommendation: PROPOSE|CLARIFY|BLOCK
reason: short string

Rules:
- Never invent a room, device, capability, property, enum value or telemetry value.
- Use only the supplied capability candidates and state.
- Corrections patch the referenced prior frame; cancellation removes only an explicitly
  resolved target.
- If reference, room, device, property, value, scope or operation is unresolved, CLARIFY.
- Never treat this response as authorization to execute a physical action.
"""


@dataclass
class BackendConfig:
    base_url: str
    model: str
    api_key: str = ""
    timeout_seconds: int = 45

    @classmethod
    def from_env(cls, prefix: str = "FLYTHINK_REASONER") -> "BackendConfig":
        return cls(
            base_url=os.environ.get(f"{prefix}_BASE_URL", "http://127.0.0.1:8000/v1").rstrip("/"),
            model=os.environ.get(f"{prefix}_MODEL", "local-reasoner"),
            api_key=os.environ.get(f"{prefix}_API_KEY", ""),
            timeout_seconds=int(os.environ.get(f"{prefix}_TIMEOUT", "45")),
        )


class ReasoningBackend:
    def __init__(self, config: BackendConfig):
        self.config = config

    def propose(
        self,
        *,
        utterance: str,
        state: Dict[str, Any],
        capability_candidates: Any,
        session_events: Optional[Any] = None,
    ) -> Dict[str, Any]:
        payload = {
            "model": self.config.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "utterance": utterance,
                            "state": state,
                            "capability_candidates": capability_candidates,
                            "recent_session_events": session_events or [],
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        }
        req = urllib.request.Request(
            f"{self.config.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                **(
                    {"Authorization": f"Bearer {self.config.api_key}"}
                    if self.config.api_key
                    else {}
                ),
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.config.timeout_seconds) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        text = raw["choices"][0]["message"]["content"]
        proposal = json.loads(_strip_code_fence(text))
        validate_proposal_shape(proposal)
        return proposal


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return text


def validate_proposal_shape(proposal: Dict[str, Any]) -> None:
    if not isinstance(proposal, dict):
        raise ValueError("proposal must be a JSON object")
    required = {"operation", "frames", "commit_recommendation"}
    missing = required - proposal.keys()
    if missing:
        raise ValueError(f"proposal missing keys: {sorted(missing)}")
    if proposal["operation"] not in {"retain", "add", "revise", "retract", "clear", "ood"}:
        raise ValueError("invalid operation")
    if proposal["commit_recommendation"] not in {"PROPOSE", "CLARIFY", "BLOCK"}:
        raise ValueError("invalid commit_recommendation")
    if not isinstance(proposal["frames"], list):
        raise ValueError("frames must be a list")
    confidence = proposal.get("confidence")
    if confidence is not None and not (
        isinstance(confidence, (int, float)) and 0 <= confidence <= 1
    ):
        raise ValueError("confidence must be between 0 and 1")


def safe_for_commit(proposal: Dict[str, Any]) -> bool:
    """Advisory only. Deterministic FlyThink gates remain authoritative."""
    validate_proposal_shape(proposal)
    return (
        proposal["commit_recommendation"] == "PROPOSE"
        and not proposal.get("ambiguity")
    )
