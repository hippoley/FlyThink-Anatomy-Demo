"use strict";

const assert=require("assert");
const {
  fuseCandidateEvidence,
  rainIngressScreeningProvider,
  acousticScreeningProvider
}=require("../scripts/pi_home_multiphysics_evidence.cjs");
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
  dimensions:["co2"]
});
const rainCert=certificate({
  provider_id:"rain-engineering",
  scope_id:"rain-v1",
  dimensions:["rain_ingress"]
});

const rainCase={
  context:{
    candidates:[
      {features:{rain_exposure:.8}},
      {features:{rain_exposure:.25}},
      {features:{rain_exposure:.1}}
    ]
  }
};
const rain=rainIngressScreeningProvider(rainCase);
assert.equal(rain.trusted_for_promotion,false);
assert.equal(rain.dimensions.rain_ingress.scores["candidate-3"],.1);

const contam={
  id:"contam-real-demo",
  kind:"simulation",
  evidence_level:"real-contam-demo-profile",
  trusted_for_promotion:false,
  dimensions:{
    co2:{
      direction:"min",
      scores:{
        "candidate-1":900,
        "candidate-2":850,
        "candidate-3":900
      }
    }
  }
};

const screening=fuseCandidateEvidence({
  required_dimensions:["co2","rain_ingress"],
  provider_results:[contam,rain],
  dimension_weights:{co2:.6,rain_ingress:.4},
  learned_candidate_label:"candidate-3"
});
assert.equal(screening.decision,"SCREENING_MISALIGNED");
assert.equal(screening.winner.label,"candidate-2");
assert.equal(screening.semantic_physics_aligned,false);
assert.equal(screening.trusted_coverage_complete,false);
assert.equal(screening.trusted_for_generalization_claim,false);

const trustedContam={
  ...contam,
  id:"contam-engineering",
  trusted_for_promotion:true,
  evidence_level:"engineering-validated",
  trust_attestation:{
    scope_id:"home-profile-v1",
    calibration_ref:contamCert.calibration_ref,
    calibration_digest:contamCert.calibration_digest
  }
};
const trustedRain={
  ...rain,
  id:"rain-engineering",
  trusted_for_promotion:true,
  evidence_level:"engineering-validated",
  trust_attestation:{
    scope_id:"rain-v1",
    calibration_ref:rainCert.calibration_ref,
    calibration_digest:rainCert.calibration_digest
  }
};
const trustRegistry=buildCertifiedProviderTrustRegistry([
  {certificate:contamCert,approved_by:"engineering-review-board"},
  {certificate:rainCert,approved_by:"engineering-review-board"}
]);
const claimedOnly=fuseCandidateEvidence({
  required_dimensions:["co2","rain_ingress"],
  provider_results:[trustedContam,trustedRain],
  dimension_weights:{co2:.6,rain_ingress:.4},
  learned_candidate_label:"candidate-3"
});
assert.equal(claimedOnly.decision,"SCREENING_MISALIGNED");
assert.equal(claimedOnly.winner.label,"candidate-2");
assert.equal(claimedOnly.trusted_coverage_complete,false);
assert.equal(claimedOnly.trusted_for_generalization_claim,false);

const trusted=fuseCandidateEvidence({
  required_dimensions:["co2","rain_ingress"],
  provider_results:[trustedContam,trustedRain],
  dimension_weights:{co2:.6,rain_ingress:.4},
  learned_candidate_label:"candidate-3",
  trust_registry:trustRegistry
});
assert.equal(trusted.decision,"MISALIGNED");
assert.equal(trusted.winner.label,"candidate-2");
assert.equal(trusted.trusted_coverage_complete,true);
assert.equal(trusted.trusted_for_generalization_claim,false);

const trustedAligned=fuseCandidateEvidence({
  required_dimensions:["co2","rain_ingress"],
  provider_results:[trustedContam,trustedRain],
  dimension_weights:{co2:.6,rain_ingress:.4},
  learned_candidate_label:"candidate-2",
  trust_registry:trustRegistry
});
assert.equal(trustedAligned.decision,"ALIGNED");
assert.equal(trustedAligned.winner.label,"candidate-2");
assert.equal(trustedAligned.trusted_coverage_complete,true);
assert.equal(trustedAligned.trusted_for_generalization_claim,true);

const missing=fuseCandidateEvidence({
  required_dimensions:["co2","rain_ingress"],
  provider_results:[contam],
  learned_candidate_label:"candidate-2"
});
assert.equal(missing.decision,"NOT_ADJUDICABLE");
assert.deepEqual(missing.missing_dimensions,["rain_ingress"]);

const quietCase={
  context:{
    candidates:[
      {features:{noise_cost:.85}},
      {features:{noise_cost:.15}}
    ]
  }
};
const noise=acousticScreeningProvider(quietCase);
const quiet=fuseCandidateEvidence({
  required_dimensions:["noise"],
  provider_results:[noise],
  learned_candidate_label:"candidate-2"
});
assert.equal(quiet.decision,"SCREENING_ALIGNED");
assert.equal(quiet.winner.label,"candidate-2");
assert.equal(quiet.trusted_for_generalization_claim,false);

console.log(JSON.stringify({
  ok:true,
  contract:"multi-physics fusion may screen with untrusted providers but only complete trusted dimension evidence may support promotion"
}));
