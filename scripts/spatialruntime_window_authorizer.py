#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import sys
from hashlib import sha256
from typing import Any, Mapping

from spatialruntime.runtime.session import RuntimeSession
from spatialruntime.safety.dependency_graph import SCHEMA as SAFETY_GRAPH_SCHEMA, compile_safety_graph


REQUEST_SCHEMA = "homeai_spatialruntime_authorization_request_v1"
RECEIPT_SCHEMA = "homeai_spatialruntime_authorization_receipt_v1"


def canonical_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(k): canonical_value(value[k]) for k in sorted(value)}
    if isinstance(value, list):
        return [canonical_value(item) for item in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("authorization_receipt_non_finite_number")
        if value.is_integer():
            return int(value)
    return value


def canonical(value: Any) -> str:
    return json.dumps(
        canonical_value(value),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


def digest(value: Any) -> str:
    return sha256(canonical(value).encode()).hexdigest()


def device_key(target: Mapping[str, Any]) -> str:
    return "::".join(
        [
            str(target.get("area") or ""),
            str(target.get("entity") or ""),
            str(target.get("instance") or "default"),
        ]
    )


def normalize_rain(value: Any) -> str:
    if value is True:
        return "wet"
    if value is False or value is None:
        return "dry"
    text = str(value).strip().lower()
    if text in {"wet", "rain", "raining", "true", "1", "yes"}:
        return "wet"
    return "dry"


def authorize(request: Mapping[str, Any]) -> dict[str, Any]:
    if request.get("schema") != REQUEST_SCHEMA:
        raise ValueError("invalid_authorization_request_schema")

    case_id = str(request.get("case_id") or "")
    if not case_id:
        raise ValueError("authorization_case_id_required")
    step = int(request.get("source_step", 0))
    revision = int(request.get("source_revision", step))
    requested_pin = request.get("spatialruntime_pin")
    env_pin = os.environ.get("SPATIALRUNTIME_PIN")
    spatialruntime_pin = env_pin or requested_pin
    if spatialruntime_pin is not None:
        spatialruntime_pin = str(spatialruntime_pin)
        if len(spatialruntime_pin) != 40 or any(
            ch not in "0123456789abcdef" for ch in spatialruntime_pin.lower()
        ):
            raise ValueError("spatialruntime_pin_invalid")
        spatialruntime_pin = spatialruntime_pin.lower()
    if env_pin and requested_pin and str(env_pin).lower() != str(requested_pin).lower():
        raise ValueError("spatialruntime_pin_environment_mismatch")

    home_runtime = request.get("runtime")
    if not isinstance(home_runtime, Mapping):
        raise ValueError("authorization_runtime_required")
    devices = home_runtime.get("devices") or {}
    if not isinstance(devices, Mapping):
        raise ValueError("authorization_runtime_devices_invalid")

    patches = request.get("patches")
    if not isinstance(patches, list) or not patches:
        raise ValueError("authorization_patches_required")

    spatial_context = request.get("spatial_context") or {}
    if not isinstance(spatial_context, Mapping):
        raise ValueError("authorization_spatial_context_invalid")
    exterior_keys = set(spatial_context.get("exterior_window_keys") or [])
    rain = normalize_rain(spatial_context.get("rain"))
    scene_evidence = spatial_context.get("scene_evidence")
    if scene_evidence is not None:
        if not isinstance(scene_evidence, Mapping):
            raise ValueError("spatialruntime_scene_evidence_invalid")
        if scene_evidence.get("schema") != "homeai_spatialruntime_scene_context_v1":
            raise ValueError("spatialruntime_scene_evidence_schema_invalid")
        for key in (
            "world_snapshot_sha256",
            "validation_receipt_sha256",
            "source_fingerprint",
            "relation_graph_fingerprint",
            "context_sha256",
        ):
            value = str(scene_evidence.get(key) or "")
            if len(value) != 64 or any(ch not in "0123456789abcdef" for ch in value):
                raise ValueError(f"spatialruntime_scene_evidence_sha_invalid:{key}")
        declared_keys = set(scene_evidence.get("exterior_window_keys") or [])
        if declared_keys != exterior_keys:
            raise ValueError("spatialruntime_scene_exterior_keys_mismatch")
        context_base = dict(scene_evidence)
        saved_context_sha = context_base.pop("context_sha256", None)
        if saved_context_sha != digest(context_base):
            raise ValueError("spatialruntime_scene_context_sha_mismatch")

    runtime_state: dict[str, Any] = {}
    entity_catalog: dict[str, Any] = {}
    policy_changes: dict[str, Any] = {}
    patch_by_entity: dict[str, dict[str, Any]] = {}

    for raw in patches:
        if not isinstance(raw, Mapping):
            raise ValueError("authorization_patch_must_be_object")
        if raw.get("op") != "PATCH_SLOT":
            raise ValueError("spatialruntime_consumer_only_supports_patch_slot")
        target = raw.get("target")
        if not isinstance(target, Mapping):
            raise ValueError("authorization_patch_target_required")
        if str(target.get("entity") or "") not in {"窗", "窗户"}:
            raise ValueError("spatialruntime_consumer_only_supports_window_targets")
        if raw.get("slot") != "opening":
            raise ValueError("spatialruntime_consumer_only_supports_window_opening")
        key = device_key(target)
        device = devices.get(key)
        if not isinstance(device, Mapping):
            raise ValueError(f"spatialruntime_target_not_in_runtime:{key}")
        slots = device.get("slots") or {}
        if "opening" not in slots:
            raise ValueError(f"spatialruntime_window_opening_state_missing:{key}")
        current_pct = float(slots["opening"])
        requested_pct = float(raw.get("value"))
        if not (0.0 <= current_pct <= 100.0 and 0.0 <= requested_pct <= 100.0):
            raise ValueError("spatialruntime_window_opening_out_of_range")

        runtime_state[key] = {"executed_state": {"open_ratio": current_pct / 100.0}}
        entity_catalog[key] = {
            "kind": "window",
            "exterior": key in exterior_keys,
            "area": target.get("area"),
            "model_id": device.get("model_id"),
        }
        policy_changes[key] = {"open_ratio": requested_pct / 100.0}
        patch_by_entity[key] = dict(raw)

    safety_graph = {
        "schema": SAFETY_GRAPH_SCHEMA,
        "rules": [
            {
                "id": "rain_closes_reviewed_exterior_windows",
                "priority": 100,
                "when": {"path": "sensors.rain.value", "op": "eq", "value": "wet"},
                "effects": [
                    {
                        "kind": "emit_change",
                        "selector": {"where": {"kind": "window", "exterior": True}},
                        "changes": {"open_ratio": 0.0},
                    }
                ],
            }
        ],
    }
    compiled = compile_safety_graph(safety_graph, entity_catalog)
    session = RuntimeSession(
        case_id=case_id,
        step=step,
        revision=revision,
        runtime_state=runtime_state,
        entity_catalog=entity_catalog,
        compiled_safety_graph=compiled,
    )
    trace = session.execute(
        solver_feedback={
            "source_step": step,
            "source_revision": revision,
            "zones": {},
            "flow_paths": {},
            "metadata": {"consumer": "HomeAI", "physics": "not_requested"},
        },
        policy_action={
            "source_step": step,
            "source_revision": revision,
            "changes": policy_changes,
        },
        safety_context={
            "source_step": step,
            "source_revision": revision,
            "sensors": {"rain": {"value": rain, "quality": 1.0}},
        },
        max_open_ratio_delta=float(request.get("max_open_ratio_delta", 0.25)),
    )

    commit = (trace.get("stages") or {}).get("commit") or {}
    decisions = commit.get("decisions") or {}
    authorized_patches = []
    blocked = []
    for entity_id, original in patch_by_entity.items():
        decision = decisions.get(entity_id) or {}
        if not str(decision.get("decision", "")).startswith("commit"):
            blocked.append({"entity_id": entity_id, "decision": decision})
            continue
        executed = decision.get("executed_state") or {}
        ratio = executed.get("open_ratio")
        if ratio is None:
            raise ValueError(f"spatialruntime_authorized_state_missing:{entity_id}")
        out = dict(original)
        out["value"] = round(float(ratio) * 100.0, 6)
        out["spatialruntime_decision"] = decision.get("decision")
        authorized_patches.append(out)

    allow = (
        trace.get("status") == "completed"
        and bool(commit.get("summary", {}).get("ready_to_dispatch", False))
        and not blocked
        and len(authorized_patches) == len(patches)
    )
    body = {
        "schema": RECEIPT_SCHEMA,
        "canonicalization": "sorted-json-number-normalized-v1",
        "allow": allow,
        "case_id": case_id,
        "source_step": step,
        "source_revision": revision,
        "spatialruntime_pin": spatialruntime_pin,
        "requested_patch_count": len(patches),
        "authorized_patches": authorized_patches if allow else [],
        "blocked": blocked,
        "rain": rain,
        "exterior_window_keys": sorted(exterior_keys),
        "scene_evidence": dict(scene_evidence) if isinstance(scene_evidence, Mapping) else None,
        "trace_status": trace.get("status"),
        "trace_hash": trace.get("trace_hash"),
        "safety_graph_fingerprint": (trace.get("stages") or {}).get("safety", {}).get(
            "graph_fingerprint"
        ),
        "safety_forced_entities": (trace.get("stages") or {}).get("safety", {}).get(
            "safety_forced_entities", []
        ),
        "commit_summary": commit.get("summary"),
    }
    return {**body, "receipt_sha256": digest(body)}


def main() -> int:
    try:
        raw = json.load(sys.stdin)
        if not isinstance(raw, Mapping):
            raise ValueError("authorization_request_root_must_be_object")
        receipt = authorize(raw)
        print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
        return 0 if receipt["allow"] else 3
    except Exception as exc:
        error = {
            "schema": RECEIPT_SCHEMA,
            "allow": False,
            "error": str(exc),
        }
        print(json.dumps(error, ensure_ascii=False, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
