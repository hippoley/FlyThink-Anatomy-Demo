#!/usr/bin/env python3
"""Evaluate an OpenAI-compatible reasoning backend on FlyThink semantic cases.

This script intentionally scores proposal quality only. It never calls a device and
never bypasses the existing deterministic capability/commit gates.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from reasoning_backend import BackendConfig, ReasoningBackend, safe_for_commit


def load_cases(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["cases"] if isinstance(data, dict) else data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", default="data/reasoning-backend-benchmark.json")
    parser.add_argument("--prefix", default="FLYTHINK_REASONER")
    parser.add_argument("--output", default="")
    args = parser.parse_args()

    backend = ReasoningBackend(BackendConfig.from_env(args.prefix))
    cases = load_cases(Path(args.cases))
    rows = []

    for case in cases:
        proposal = backend.propose(
            utterance=case["utterance"],
            state=case.get("state", {}),
            capability_candidates=case.get("capability_candidates", []),
            session_events=case.get("session_events", []),
        )
        expect = case["expect"]
        checks = {
            "operation": proposal.get("operation") == expect.get("operation"),
            "recommendation": proposal.get("commit_recommendation")
            == expect.get("commit_recommendation"),
            "safe_for_commit": safe_for_commit(proposal)
            == bool(expect.get("safe_for_commit", False)),
        }
        if "ambiguity_contains" in expect:
            got = set(proposal.get("ambiguity") or [])
            checks["ambiguity"] = set(expect["ambiguity_contains"]).issubset(got)
        rows.append(
            {
                "id": case["id"],
                "checks": checks,
                "pass": all(checks.values()),
                "proposal": proposal,
            }
        )

    passed = sum(row["pass"] for row in rows)
    summary = {
        "backend_model": backend.config.model,
        "cases": len(rows),
        "passed": passed,
        "pass_rate": passed / len(rows) if rows else 0,
        "rows": rows,
    }
    text = json.dumps(summary, ensure_ascii=False, indent=2)
    print(text)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
