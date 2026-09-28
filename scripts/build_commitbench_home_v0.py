#!/usr/bin/env python3
"""Build CommitBench/Home-v0 from the frozen long-trajectory benchmark.

Home-v0 is intentionally a state-integrity slice. The frozen V2 source contains
only executable turns, so Premature Commit / Missed Commit are not claimed here.
Curated ambiguity cases are emitted as a separate commit-boundary challenge slice.
"""
import argparse, copy, json, pathlib

def initial_state(tr):
    return {k: copy.deepcopy(v["slots"]) for k, v in tr["initial_runtime"]["devices"].items()}

def read_path(state, path):
    # path: devices.<area>::<entity>::default.slots.<slot>
    parts = path.split(".")
    key = parts[1]
    slot = parts[-1]
    return state[key][slot]

def delta_from_turn(before, after, write_set):
    out = []
    for p in write_set:
        out.append({
            "path": p,
            "before": read_path(before, p),
            "after": read_path(after, p),
        })
    return out

def build_state_integrity(src):
    rows = []
    for tr in src["trajectories"]:
        before = initial_state(tr)
        history = []
        for i, turn in enumerate(tr["turns"]):
            after = copy.deepcopy(turn["gold_state"])
            rows.append({
                "id": f'{tr["id"]}:turn-{i:03d}',
                "trajectory_id": tr["id"],
                "turn_index": i,
                "history": list(history),
                "utterance": turn["text"],
                "before_state": copy.deepcopy(before),
                "gold": {
                    "decision": "COMMIT",
                    "operation": turn["gold_op"],
                    "target": turn["gold_target"],
                    "write_set": turn["gold_write_set"],
                    "delta": delta_from_turn(before, after, turn["gold_write_set"]),
                    "after_state": after,
                },
                "tags": [
                    "state_integrity",
                    "relative" if turn["gold_op"] == "PATCH_RELATIVE" else "explicit",
                ],
            })
            history.append(turn["text"])
            before = after
    return rows

def build_boundary_challenge(path):
    if not path:
        return []
    d = json.loads(pathlib.Path(path).read_text())
    out = []
    for case in d.get("cases", []):
        out.append({
            "id": case["id"],
            "history": case.get("history", []),
            "utterance": case["utterance"],
            "gold": {
                "decision": case["expected_gate"],
                "must_not_mutate_world": bool(case.get("must_not_mutate_world", False)),
                "ambiguity": case.get("expected_ambiguity", []),
            },
            "observed_wrong": case.get("observed_wrong"),
            "tags": ["commit_boundary", "curated_real_failure"],
        })
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="benchmarks/long_trajectories_v2.json")
    ap.add_argument("--ambiguity", default="data/ambiguity-failure-cases.json")
    ap.add_argument("--out", default="benchmarks/commitbench_home_v0.json")
    a = ap.parse_args()

    src = json.loads(pathlib.Path(a.source).read_text())
    state_rows = build_state_integrity(src)
    boundary_rows = build_boundary_challenge(a.ambiguity)
    result = {
        "manifest": {
            "name": "CommitBench/Home-v0",
            "source_truth": src["manifest"].get("truth"),
            "source_sha256": src["manifest"].get("sha256"),
            "trajectories": src["manifest"].get("trajectories"),
            "state_integrity_turns": len(state_rows),
            "commit_boundary_cases": len(boundary_rows),
            "scope": {
                "state_integrity": True,
                "premature_commit": len(boundary_rows) > 0,
                "missed_commit": False,
                "note": "Frozen V2 contains only executable turns; do not report PCR/MCR from the state-integrity slice.",
            },
        },
        "state_integrity": state_rows,
        "commit_boundary_challenge": boundary_rows,
    }
    p = pathlib.Path(a.out)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result["manifest"], ensure_ascii=False))

if __name__ == "__main__":
    main()
