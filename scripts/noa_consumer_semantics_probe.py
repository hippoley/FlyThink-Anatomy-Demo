#!/usr/bin/env python3
"""Non-normative NOA source->consumer semantic preservation probe.

This module does NOT verify NOA signatures and does not define a NOA receipt.
It assumes the source receipt has already been verified under NOA's own rules,
then checks whether a downstream consumer preserves selected source semantics
without upgrading absent claims.

It is an upstream-contribution candidate for the gap described by NOA
ADR-R-006, not a claim of NOA conformance.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

PROFILE = "noa-consumer-semantics-probe.v0"
SUPPORTED_SOURCE = "noa.receipt/0.1"
SOURCE_ABSENT = "SOURCE_ABSENT"


def _require_dict(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{name}_required")
    return value


def project_source(receipt: dict[str, Any]) -> dict[str, Any]:
    if receipt.get("spec") != SUPPORTED_SOURCE:
        raise ValueError("unsupported_source_revision")
    action = _require_dict(receipt.get("action"), "action")
    governance = _require_dict(receipt.get("governance"), "governance")
    for field in ("id", "canonical", "paramsHash"):
        if not isinstance(action.get(field), str) or not action[field]:
            raise ValueError(f"source_action_{field}_required")
    if not isinstance(governance.get("verdict"), str) or not governance["verdict"]:
        raise ValueError("source_governance_verdict_required")

    approval = (
        copy.deepcopy(governance["approval"])
        if "approval" in governance
        else SOURCE_ABSENT
    )
    return {
        "profile": PROFILE,
        "source_revision": receipt["spec"],
        "source_receipt_id": str(receipt.get("id") or ""),
        "action": {
            "id": action["id"],
            "canonical": action["canonical"],
            "paramsHash": action["paramsHash"],
        },
        "outcome": governance["verdict"],
        "approval": approval,
        # noa.receipt/0.1 does not establish either downstream claim.
        "controller_report": SOURCE_ABSENT,
        "physical_completion": SOURCE_ABSENT,
    }


CHECKS = (
    ("profile", "profile_mismatch"),
    ("source_revision", "source_revision_mismatch"),
    ("source_receipt_id", "source_receipt_id_mismatch"),
    ("action.id", "action_id_mismatch"),
    ("action.canonical", "action_canonical_mismatch"),
    ("action.paramsHash", "params_hash_mismatch"),
    ("outcome", "outcome_mismatch"),
    ("approval", "approval_mismatch"),
    ("controller_report", "controller_report_must_be_source_absent"),
    ("physical_completion", "physical_completion_must_be_source_absent"),
)


def _path(obj: Any, dotted: str) -> Any:
    cur = obj
    for key in dotted.split("."):
        if not isinstance(cur, dict) or key not in cur:
            return None
        cur = cur[key]
    return cur


def validate_projection(
    receipt: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, Any]:
    expected = project_source(receipt)
    if not isinstance(candidate, dict):
        return {"status": "REFUSE", "code": "projection_object_required"}
    for path, code in CHECKS:
        if _path(candidate, path) != _path(expected, path):
            return {
                "status": "REFUSE",
                "code": code,
                "path": path,
                "expected": _path(expected, path),
                "actual": _path(candidate, path),
            }
    return {"status": "PASS", "code": None}


def _set_path(obj: dict[str, Any], dotted: str, value: Any) -> None:
    parts = dotted.split(".")
    cur = obj
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value


def mutate_projection(
    projection: dict[str, Any],
    mutation: dict[str, Any] | None,
) -> dict[str, Any]:
    out = copy.deepcopy(projection)
    if not mutation:
        return out
    kind = mutation.get("kind")
    if kind == "transpose_action_fields":
        out["action"]["id"], out["action"]["canonical"] = (
            out["action"]["canonical"],
            out["action"]["id"],
        )
        return out
    if kind == "set":
        _set_path(out, str(mutation["path"]), copy.deepcopy(mutation.get("value")))
        return out
    raise ValueError(f"unknown_mutation:{kind}")


def select_source(upstream: dict[str, Any], selector: dict[str, Any]) -> dict[str, Any]:
    name = selector.get("vector")
    vectors = upstream.get("vectors")
    if not isinstance(vectors, list):
        raise ValueError("upstream_vectors_required")
    row = next((x for x in vectors if isinstance(x, dict) and x.get("name") == name), None)
    if row is None:
        raise ValueError("upstream_vector_not_found")
    try:
        receipt = row["context"]["chain"][int(selector.get("chain_index", 0))]
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise ValueError("upstream_receipt_selector_invalid") from error
    return _require_dict(receipt, "upstream_receipt")


def run(upstream: dict[str, Any], inventory: dict[str, Any]) -> dict[str, Any]:
    if inventory.get("profile") != PROFILE:
        raise ValueError("vector_profile_mismatch")
    receipt = select_source(upstream, inventory.get("source_selector") or {})
    expected_projection = project_source(receipt)

    rows = []
    mismatch_count = 0
    for case in inventory.get("cases") or []:
        candidate = mutate_projection(expected_projection, case.get("mutation"))
        verdict = validate_projection(receipt, candidate)
        expected_status = case.get("expected_status")
        expected_code = case.get("expected_code")
        matched = (
            verdict["status"] == expected_status
            and verdict.get("code") == expected_code
        )
        mismatch_count += int(not matched)
        rows.append({
            "name": case.get("name"),
            "expected_status": expected_status,
            "expected_code": expected_code,
            "actual": verdict,
            "matched": matched,
        })

    return {
        "profile": PROFILE,
        "source_revision": receipt.get("spec"),
        "source_receipt_id": receipt.get("id"),
        "cases": rows,
        "mismatches": mismatch_count,
        "status": "PASS" if mismatch_count == 0 and rows else "FAIL",
        "claim_boundary": [
            "NOA source verification is out of scope for this probe",
            "the probe does not define or extend noa.receipt/0.1",
            "SOURCE_ABSENT claims are not inferred from governance verdicts",
            "passing this probe is not NOA conformance or independent adoption",
        ],
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--upstream-vectors", required=True, type=Path)
    p.add_argument("--inventory", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()

    upstream = json.loads(args.upstream_vectors.read_text(encoding="utf-8"))
    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    report = run(upstream, inventory)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    if report["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
