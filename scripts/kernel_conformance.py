#!/usr/bin/env python3
"""Model-agnostic conformance rail for bounded state-transition kernels.

Input JSON files contain rows with:
  id, confidence, exact,
  wrong_target (optional bool),
  untouched_state_corruption (optional bool),
  ood_false_commit (optional bool)

A confidence threshold is selected on calibration rows only, then frozen and
applied to sealed rows. The sealed labels never choose their own threshold.
"""
import argparse
import json
from pathlib import Path


def coverage_at_precision(rows, target=0.99):
    ordered=sorted(
        [(float(r["confidence"]), bool(r["exact"])) for r in rows],
        reverse=True,
    )
    if not ordered:
        return {"coverage":0.0,"precision":None,"threshold":None,"committed":0}
    best={"coverage":0.0,"precision":None,"threshold":None,"committed":0}
    correct=0
    committed=0
    i=0
    while i<len(ordered):
        threshold=ordered[i][0]
        group=[]
        while i<len(ordered) and ordered[i][0]==threshold:
            group.append(ordered[i])
            i+=1
        committed+=len(group)
        correct+=sum(int(ok) for _,ok in group)
        precision=correct/committed
        if precision>=target:
            best={
                "coverage":committed/len(ordered),
                "precision":precision,
                "threshold":threshold,
                "committed":committed,
            }
    return best


def evaluate_fixed(rows, threshold):
    if threshold is None:
        committed=[]
    else:
        committed=[r for r in rows if float(r["confidence"])>=threshold]
    correct=sum(int(bool(r["exact"])) for r in committed)
    result={
        "rows":len(rows),
        "committed":len(committed),
        "coverage":len(committed)/len(rows) if rows else 0.0,
        "precision":correct/len(committed) if committed else None,
        "threshold":threshold,
    }
    for field in ("wrong_target","untouched_state_corruption","ood_false_commit"):
        applicable=[r for r in committed if field in r]
        result[field+"_rate"]=(
            sum(int(bool(r[field])) for r in applicable)/len(applicable)
            if applicable else None
        )
    return result


def load(path):
    data=json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data,dict) and "rows" in data:
        data=data["rows"]
    if not isinstance(data,list):
        raise ValueError("conformance_input_must_be_list_or_rows_object")
    ids=[str(r.get("id","")) for r in data]
    if len(ids)!=len(set(ids)):
        raise ValueError("duplicate_row_id")
    for r in data:
        if not r.get("id"):
            raise ValueError("row_id_required")
        if "confidence" not in r or "exact" not in r:
            raise ValueError("confidence_and_exact_required")
        c=float(r["confidence"])
        if c<0 or c>1:
            raise ValueError("confidence_out_of_range")
    return data


def run(calibration, sealed, target=0.99):
    gate=coverage_at_precision(calibration,target)
    return {
        "contract":"state-transition-kernel-conformance.v1",
        "target_precision":target,
        "threshold_source":"calibration_only",
        "calibration":gate,
        "sealed":evaluate_fixed(sealed,gate["threshold"]),
        "claim_boundary":[
            "sealed labels never select their own threshold",
            "results describe the supplied frozen rows only",
            "no model architecture receives privileged treatment",
        ],
    }


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--calibration",required=True)
    p.add_argument("--sealed",required=True)
    p.add_argument("--target-precision",type=float,default=0.99)
    p.add_argument("--out",type=Path)
    a=p.parse_args()
    report=run(load(a.calibration),load(a.sealed),a.target_precision)
    text=json.dumps(report,ensure_ascii=False,indent=2)
    if a.out:
        a.out.parent.mkdir(parents=True,exist_ok=True)
        a.out.write_text(text,encoding="utf-8")
    print(text)


if __name__=="__main__":
    main()
