"use strict";

const assert=require("assert");
const {
  buildEvidenceCoverage,
  adjudicateEvidence
}=require("../scripts/pi_home_evidence_adjudicator.cjs");
const {
  evaluateCalibrationDataset,
  buildCertifiedProviderTrustRegistry
}=require("../scripts/pi_home_provider_calibration.cjs");

function calibrationSamples(providerId,dimension,count,offset){
  return Array.from({length:count},(_,i)=>({
    id:providerId+"-"+dimension+"-"+String(i+1),
    measurement_ref:"measurement://"+providerId+"/"+dimension+"/"+String(i+1),
    dimension,
    predicted:i+offset,
    observed:i
  }));
}

function certificate({provider_id,scope_id,dimensions,evidence_level="engineering-validated"}){
  const samples=[];
  const thresholds={};
  for(const dimension of dimensions){
    const offset=dimension==="co2"?.05:.01;
    samples.push(...calibrationSamples(provider_id,dimension,20,offset));
    thresholds[dimension]={
      min_samples:20,
      max_mae:dimension==="co2"?.1:.02,
      max_rmse:dimension==="co2"?.1:.02,
      max_abs_error:dimension==="co2"?.1:.02
    };
  }
  return evaluateCalibrationDataset({
    schema_version:"pi-home-provider-calibration-dataset-v1",
    provider_id,
    scope_id,
    evidence_level,
    source_kind:"measured",
    samples
  },{thresholds});
}

const contamCert=certificate({
  provider_id:"contam-engineering",
  scope_id:"home-profile-v1",
  dimensions:["co2","airflow"]
});
const rainCert=certificate({
  provider_id:"rain-engineering",
  scope_id:"rain-v1",
  dimensions:["rain_ingress"]
});
const trustRegistry=buildCertifiedProviderTrustRegistry([
  {certificate:contamCert,approved_by:"engineering-review-board"},
  {certificate:rainCert,approved_by:"engineering-review-board"}
]);

const contam={
  id:"contam-transient",
  kind:"simulation",
  covered_dimensions:["co2","airflow"],
  evidence_level:"real-contam-transient-demo-profile",
  trusted_for_promotion:false,
  provenance:{engine:"ContamX 3.4.1.7"}
};

const rainHeuristic={
  id:"rain-screening",
  kind:"heuristic-screening",
  covered_dimensions:["rain_ingress"],
  evidence_level:"heuristic-only",
  trusted_for_promotion:false
};

const rainEngineering={
  id:"rain-engineering",
  kind:"engineering-model",
  covered_dimensions:["rain_ingress"],
  evidence_level:"engineering-validated",
  trusted_for_promotion:true,
  trust_attestation:{
    scope_id:"rain-v1",
    calibration_ref:rainCert.calibration_ref,
    calibration_digest:rainCert.calibration_digest
  }
};

const trustedContam={
  ...contam,
  id:"contam-engineering",
  evidence_level:"engineering-validated",
  trusted_for_promotion:true,
  trust_attestation:{
    scope_id:"home-profile-v1",
    calibration_ref:contamCert.calibration_ref,
    calibration_digest:contamCert.calibration_digest
  }
};

{
  const coverage=buildEvidenceCoverage({
    required_dimensions:["co2","rain_ingress"],
    providers:[contam]
  });
  assert.deepEqual(coverage.missing_dimensions,["rain_ingress"]);
  assert.equal(coverage.coverage_complete,false);

  const out=adjudicateEvidence({
    required_dimensions:["co2","rain_ingress"],
    providers:[contam],
    raw_target_match:false,
    physical_candidate_comparison_available:true,
    trust_registry:trustRegistry
  });
  assert.equal(out.decision,"NOT_ADJUDICABLE");
  assert.equal(out.semantic_physics_aligned,null);
  assert.equal(out.trusted_for_generalization_claim,false);
}

{
  const out=adjudicateEvidence({
    required_dimensions:["co2","rain_ingress"],
    providers:[contam,rainHeuristic],
    raw_target_match:true,
    physical_candidate_comparison_available:true
  });
  assert.equal(out.decision,"ALIGNED");
  assert.deepEqual(out.coverage.missing_dimensions,[]);
  assert.deepEqual(out.coverage.untrusted_dimensions,["co2","rain_ingress"]);
  assert.equal(out.trusted_for_generalization_claim,false);
}

{
  const out=adjudicateEvidence({
    required_dimensions:["co2","rain_ingress"],
    providers:[trustedContam,rainEngineering],
    raw_target_match:true,
    physical_candidate_comparison_available:true
  });
  assert.equal(out.decision,"ALIGNED");
  assert.equal(out.coverage.trusted_coverage_complete,false);
  assert.deepEqual(out.coverage.untrusted_dimensions,["co2","rain_ingress"]);
  assert.equal(out.trusted_for_generalization_claim,false);
}

{
  const out=adjudicateEvidence({
    required_dimensions:["co2","rain_ingress"],
    providers:[trustedContam,rainEngineering],
    raw_target_match:true,
    physical_candidate_comparison_available:true,
    trust_registry:trustRegistry
  });
  assert.equal(out.decision,"ALIGNED");
  assert.equal(out.coverage.trusted_coverage_complete,true);
  assert.equal(out.trusted_for_generalization_claim,true);
}

{
  const out=adjudicateEvidence({
    required_dimensions:["co2","rain_ingress"],
    providers:[trustedContam,rainEngineering],
    raw_target_match:false,
    physical_candidate_comparison_available:true
  });
  assert.equal(out.decision,"MISALIGNED");
  assert.equal(out.semantic_physics_aligned,false);
  assert.equal(out.trusted_for_generalization_claim,false);
}

{
  const out=adjudicateEvidence({
    required_dimensions:["co2"],
    providers:[trustedContam],
    raw_target_match:true,
    physical_candidate_comparison_available:false
  });
  assert.equal(out.decision,"BLOCKED");
  assert.equal(out.reason,"candidate_comparison_missing");
}

console.log(JSON.stringify({
  ok:true,
  contract:"missing dimensions are NOT_ADJUDICABLE; complete untrusted evidence cannot promote; only complete trusted evidence may support a trusted claim"
}));
