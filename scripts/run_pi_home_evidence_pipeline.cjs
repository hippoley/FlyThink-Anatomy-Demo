#!/usr/bin/env node
"use strict";

const fs=require("fs");
const {adjudicateEvidence}=require("./pi_home_evidence_adjudicator.cjs");
const {summarizePhysicalGeneralization}=require("./pi_home_generalization_claim.cjs");

function arg(name,def=null){
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:def;
}
function readJson(path){return JSON.parse(fs.readFileSync(path,"utf8"))}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function contamProvider(row){
  if(!row||row.status!=="REAL_CONTAM_EXECUTED")return null;
  return {
    id:"airtrajectory-contam-transient",
    kind:"counterfactual-simulation",
    covered_dimensions:clone(row.covered_dimensions||["co2","airflow"]),
    evidence_level:String(row.evidence_level||"unspecified"),
    trusted_for_promotion:row.profile_trusted_for_promotion===true,
    provenance:{
      backend:row.backend||null,
      physics_fidelity:row.physics_fidelity||null,
      engine_version:row.engine_version||null,
      co2_dynamics_discriminative:row.co2_dynamics_discriminative===true
    }
  };
}

function buildCaseAdjudication(row){
  const provider=contamProvider(row);
  const providers=provider?[provider]:[];
  const comparisonAvailable=
    row&&row.status==="REAL_CONTAM_EXECUTED"&&
    row.co2_dynamics_discriminative===true;
  const out=adjudicateEvidence({
    required_dimensions:clone(row&&row.required_dimensions||[]),
    providers,
    raw_target_match:typeof (row&&row.raw_target_match)==="boolean"?row.raw_target_match:null,
    physical_candidate_comparison_available:comparisonAvailable
  });
  return {
    id:row&&row.case_id||null,
    source_status:row&&row.status||null,
    source_reason:row&&row.reason||null,
    ...out
  };
}

function main(){
  const evidencePath=arg("--evidence");
  const learnedPath=arg("--learned-eval");
  const outPath=arg("--out");
  if(!evidencePath||!learnedPath||!outPath){
    throw new Error("usage: --evidence <json> --learned-eval <json> --out <json>");
  }
  const evidence=readJson(evidencePath);
  const learned=readJson(learnedPath);
  if(evidence.schema_version!=="pi-home-p47-real-contam-evidence-v1"){
    throw new Error("real_contam_evidence_required");
  }
  if(learned.schema_version!=="pi-home-learned-checkpoint-shadow-eval-v1"){
    throw new Error("learned_checkpoint_eval_required");
  }

  const rows=evidence.results||[];
  const adjudications=rows.map(buildCaseAdjudication);
  const learnedRows=learned.rows||[];
  const labelSupported=
    learned.exact_replay_hits===0 &&
    learned.exact===1 &&
    learnedRows.length>0;

  const generalizationEval={
    schema_version:"pi-home-generalization-eval-v1",
    holdout:{cases:learnedRows.length},
    claim:{generalization_reality_delta:labelSupported}
  };
  const claim=summarizePhysicalGeneralization({
    generalization_eval:generalizationEval,
    alignments:adjudications
  });

  const output={
    schema_version:"pi-home-p410-evidence-pipeline-v1",
    shadow_only:true,
    device_execution_authorized:false,
    learned_checkpoint_label_supported:labelSupported,
    evidence_source:{
      schema_version:evidence.schema_version,
      topology_id:evidence.topology_id||null,
      contaminant_simulation_mode:evidence.contaminant_simulation_mode||null,
      simulation_time_step_s:evidence.simulation_time_step_s||null,
      engineering_profile_ready:evidence.engineering_profile_ready===true
    },
    adjudications,
    claim
  };
  fs.writeFileSync(outPath,JSON.stringify(output,null,2)+"\n","utf8");
  process.stdout.write(JSON.stringify(output)+"\n");
}

if(require.main===module){
  try{main()}catch(err){console.error(err&&err.stack||err);process.exit(1)}
}

module.exports={contamProvider,buildCaseAdjudication};
