"use strict";

const assert=require("assert");
const {buildCaseAdjudication}=require("../scripts/run_pi_home_evidence_pipeline.cjs");

const quiet=buildCaseAdjudication({
  case_id:"compose-quiet-new-room",
  status:"BLOCKED",
  reason:"candidate_set_not_fully_contam_modelled",
  required_dimensions:["co2","noise"],
  covered_dimensions:["co2","airflow"]
});
assert.equal(quiet.decision,"BLOCKED");
assert.equal(quiet.reason,"candidate_comparison_missing");
assert.equal(quiet.source_reason,"candidate_set_not_fully_contam_modelled");

const rain=buildCaseAdjudication({
  case_id:"topology-rain-new-apt",
  status:"REAL_CONTAM_EXECUTED",
  backend:"contamxpy",
  physics_fidelity:"CONTAM",
  engine_version:"3.4.1.7-64bit",
  evidence_level:"real-contam-transient-demo-profile",
  profile_trusted_for_promotion:false,
  required_dimensions:["co2","rain_ingress"],
  covered_dimensions:["co2","airflow"],
  co2_dynamics_discriminative:true,
  raw_target_match:false
});
assert.equal(rain.decision,"NOT_ADJUDICABLE");
assert.equal(rain.reason,"required_evidence_dimensions_missing");
assert.deepEqual(rain.coverage.missing_dimensions,["rain_ingress"]);
assert.deepEqual(rain.coverage.untrusted_dimensions,["co2"]);
assert.equal(rain.semantic_physics_aligned,null);
assert.equal(rain.trusted_for_generalization_claim,false);
assert.equal(rain.coverage.providers.length,1);
assert.equal(rain.coverage.providers[0].id,"airtrajectory-contam-transient");

console.log(JSON.stringify({
  ok:true,
  contract:"real transient CONTAM evidence is directly adjudicated; missing rain/noise evidence remains blocked or not adjudicable"
}));
