"use strict";

const assert=require("assert");
const {
  buildEvidenceCoverage,
  adjudicateEvidence
}=require("../scripts/pi_home_evidence_adjudicator.cjs");
const {buildProviderTrustRegistry}=require("../scripts/pi_home_provider_trust.cjs");

const contamDigest="sha256:"+"a".repeat(64);
const rainDigest="sha256:"+"b".repeat(64);
const trustRegistry=buildProviderTrustRegistry([
  {
    provider_id:"contam-engineering",
    status:"active",
    scope_id:"home-profile-v1",
    allowed_dimensions:["co2","airflow"],
    allowed_evidence_levels:["engineering-validated"],
    calibration_ref:"calibration://contam/home-v1",
    calibration_digest:contamDigest,
    approved_by:"engineering-review-board"
  },
  {
    provider_id:"rain-engineering",
    status:"active",
    scope_id:"rain-v1",
    allowed_dimensions:["rain_ingress"],
    allowed_evidence_levels:["engineering-validated"],
    calibration_ref:"calibration://rain/v1",
    calibration_digest:rainDigest,
    approved_by:"engineering-review-board"
  }
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
    calibration_ref:"calibration://rain/v1",
    calibration_digest:rainDigest
  }
};

const trustedContam={
  ...contam,
  id:"contam-engineering",
  evidence_level:"engineering-validated",
  trusted_for_promotion:true,
  trust_attestation:{
    scope_id:"home-profile-v1",
    calibration_ref:"calibration://contam/home-v1",
    calibration_digest:contamDigest
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
