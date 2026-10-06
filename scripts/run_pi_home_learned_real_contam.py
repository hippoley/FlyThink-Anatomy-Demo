#!/usr/bin/env python3
"""Run learned holdout candidates through the real AirTrajectory/ContamX fork.

This script deliberately distinguishes:
- real ContamX execution, from
- engineering-trusted evidence.

The generated AirTrajectory demo PRJ is real-engine executable but explicitly
not engineering truth, so its evidence must remain non-promotable.
"""
import argparse
import json
from pathlib import Path

from airtrajectory.contam import ContamControl
from airtrajectory.contam_fork import ContamForkProfile, contam_strategy_fork_request
from airtrajectory.layout import LayoutContract


def target_key(target):
    return f'{target["area"]}::{target["entity"]}::{target.get("instance","default")}'


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def profile_from_generated_prj(airtrajectory_root, prj_path, provenance):
    root=Path(airtrajectory_root)
    layout=LayoutContract.from_file(root/"web"/"data"/"home_topology.fixed.json")
    topology=layout.to_building_topology()

    zone_numbers={
        key.split(":",1)[1]:int(value)
        for key,value in provenance["zone_numbers"].items()
        if key.startswith("zone:")
    }
    path_numbers={
        key.split(":",1)[1]:int(value)
        for key,value in provenance["path_numbers"].items()
        if key.startswith("path:")
    }
    names=dict(provenance.get("input_control_names") or {})
    ranges=dict(provenance.get("input_control_ranges") or {})
    controls={}
    for opening_id,name in names.items():
        bounds=dict(ranges.get(opening_id) or {})
        controls[opening_id]=ContamControl(
            control_name=name,
            closed_value=float(bounds.get("closed_value",0.0)),
            open_value=float(bounds.get("open_value",1.0)),
        )

    fixed={
        opening_id:100.0
        for opening_id in topology.openings
        if opening_id not in controls
    }
    engineering=provenance.get("engineering_readiness") or {}
    engineering_ready=bool(
        provenance.get("engineering_truth") is True
        and engineering.get("engineering_ready") is True
    )
    evidence_level=(
        "engineering-trusted"
        if engineering_ready
        else "real-contam-demo-profile"
    )
    profile=ContamForkProfile(
        profile_id=layout.topology_id,
        topology=topology,
        prj_path=prj_path,
        zone_numbers=zone_numbers,
        opening_controls=controls,
        path_numbers=path_numbers,
        fixed_openings=fixed,
        ambient=dict(provenance.get("contam_ambient") or {}),
        initial_input_controls={
            int(index):dict(spec)
            for index,spec in (provenance.get("initial_input_controls") or {}).items()
        },
        evaluation_zone="living",
        evidence_level=evidence_level,
        trusted_for_promotion=engineering_ready,
    )
    return layout,profile,engineering_ready,evidence_level


def build_candidates(case):
    opening_map=(case.get("physics") or {}).get("opening_map") or {}
    candidates=[]
    unsupported=[]
    for index,candidate in enumerate(case["context"]["candidates"],start=1):
        action=candidate.get("action") or {}
        target=candidate["target"]
        if action.get("op")!="PATCH_SLOT" or action.get("slot")!="opening":
            unsupported.append({
                "target":target,
                "reason":"non_opening_candidate"
            })
            continue
        opening_id=opening_map.get(target_key(target))
        if not opening_id:
            unsupported.append({
                "target":target,
                "reason":"opening_mapping_missing"
            })
            continue
        candidates.append({
            "label":f"candidate-{index}",
            "target":target,
            "actions":[{
                "opening_id":opening_id,
                "target_pct":float(action["value"])
            }]
        })
    return candidates,unsupported


def learned_row_for(learned_eval,case_id):
    for row in learned_eval.get("rows") or []:
        if row.get("id")==case_id:
            return row
    raise ValueError(f"learned eval row missing: {case_id}")


def run_case(case,learned_row,profile):
    candidates,unsupported=build_candidates(case)
    if unsupported:
        return {
            "case_id":case["id"],
            "status":"BLOCKED",
            "reason":"candidate_set_not_fully_contam_modelled",
            "unsupported":unsupported,
            "required_dimensions":(case.get("physics") or {}).get("required_dimensions") or [],
            "covered_dimensions":["co2","airflow"],
            "trusted_for_generalization_claim":False,
        }
    physics=case["physics"]
    payload={
        "request_id":"p47-real-contam:"+case["id"],
        "profile_id":profile.profile_id,
        "topology_id":profile.profile_id,
        "origin":physics["origin"],
        "candidates":[
            {"label":x["label"],"actions":x["actions"]}
            for x in candidates
        ],
        "horizon_steps":2,
        "evaluation_zone":"living",
    }
    response=contam_strategy_fork_request(
        payload,
        {profile.profile_id:profile},
    )

    by_label={x["label"]:x for x in candidates}
    winner=max(response["branches"],key=lambda x:float(x["return"]))
    winner_target=by_label[winner["label"]]["target"]
    learned_target=learned_row["predicted"]
    aligned=target_key(winner_target)==target_key(learned_target)

    required=set(physics.get("required_dimensions") or [])
    covered={"co2","airflow"}
    missing=sorted(required-covered)
    dimensions_complete=not missing
    trusted=bool(
        response.get("trusted_for_promotion") is True
        and winner.get("trusted_for_promotion") is True
        and aligned
        and dimensions_complete
    )

    contam=response.get("contam") or {}
    return {
        "case_id":case["id"],
        "status":"REAL_CONTAM_EXECUTED",
        "backend":response.get("backend"),
        "physics_fidelity":response.get("physics_fidelity"),
        "evidence_level":response.get("evidence_level"),
        "engine_version":contam.get("version"),
        "profile_trusted_for_promotion":bool(response.get("trusted_for_promotion")),
        "learned_target":learned_target,
        "physical_winner_target":winner_target,
        "semantic_physics_aligned":aligned,
        "required_dimensions":sorted(required),
        "covered_dimensions":sorted(covered),
        "missing_dimensions":missing,
        "dimension_coverage_complete":dimensions_complete,
        "trusted_for_generalization_claim":trusted,
        "winner":{
            "label":winner["label"],
            "return":winner["return"],
            "end_co2_ppm":winner["end_co2_ppm"],
            "end_co2_ppm_by_zone":winner.get("end_co2_ppm_by_zone") or {},
            "path_flow_kg_s":winner.get("path_flow_kg_s") or {},
            "provenance":winner.get("provenance"),
            "trusted_for_promotion":winner.get("trusted_for_promotion"),
        },
        "branches":response["branches"],
    }


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--benchmark",default="benchmarks/pi_home_candidate_generalization.json")
    ap.add_argument("--learned-eval",required=True)
    ap.add_argument("--airtrajectory-root",required=True)
    ap.add_argument("--prj",required=True)
    ap.add_argument("--provenance",required=True)
    ap.add_argument("--out",required=True)
    args=ap.parse_args()

    benchmark=load_json(args.benchmark)
    learned_eval=load_json(args.learned_eval)
    provenance=load_json(args.provenance)
    layout,profile,engineering_ready,evidence_level=profile_from_generated_prj(
        args.airtrajectory_root,args.prj,provenance
    )

    results=[]
    for case in benchmark["cases"]:
        results.append(run_case(
            case,
            learned_row_for(learned_eval,case["id"]),
            profile,
        ))

    executed=[x for x in results if x["status"]=="REAL_CONTAM_EXECUTED"]
    trusted=[x for x in executed if x["trusted_for_generalization_claim"]]
    payload={
        "schema_version":"pi-home-p47-real-contam-evidence-v1",
        "shadow_only":True,
        "topology_id":layout.topology_id,
        "real_contam_executed":bool(executed),
        "engineering_profile_ready":engineering_ready,
        "evidence_level":evidence_level,
        "cases":len(results),
        "real_contam_cases":len(executed),
        "trusted_generalization_cases":len(trusted),
        "device_execution_authorized":False,
        "results":results,
    }
    Path(args.out).write_text(
        json.dumps(payload,ensure_ascii=False,indent=2)+"\n",
        encoding="utf-8",
    )
    print(json.dumps(payload,ensure_ascii=False))

    if not executed:
        raise SystemExit("no real CONTAM holdout case executed")
    if engineering_ready:
        raise SystemExit("generated demo PRJ unexpectedly became engineering trusted")
    if any(x.get("trusted_for_generalization_claim") for x in results):
        raise SystemExit("demo-profile CONTAM evidence must not support trusted generalization")

if __name__=="__main__":
    main()
