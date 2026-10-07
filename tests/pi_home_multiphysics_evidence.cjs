"use strict";

const assert=require("assert");
const {
  fuseCandidateEvidence,
  rainIngressScreeningProvider,
  acousticScreeningProvider
}=require("../scripts/pi_home_multiphysics_evidence.cjs");

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
  calibration:{
    status:"validated",
    validation_id:"contam-cal-v1",
    covered_dimensions:["co2"]
  }
};
const trustedRain={
  ...rain,
  id:"rain-engineering",
  trusted_for_promotion:true,
  evidence_level:"engineering-validated",
  calibration:{
    status:"validated",
    validation_id:"rain-cal-v1",
    covered_dimensions:["rain_ingress"]
  }
};
const uncalibratedTrusted=fuseCandidateEvidence({
  required_dimensions:["co2","rain_ingress"],
  provider_results:[
    {...contam,id:"contam-claims-trust",trusted_for_promotion:true},
    {...rain,id:"rain-claims-trust",trusted_for_promotion:true}
  ],
  dimension_weights:{co2:.6,rain_ingress:.4},
  learned_candidate_label:"candidate-3"
});
assert.equal(uncalibratedTrusted.decision,"SCREENING_ALIGNED");
assert.equal(uncalibratedTrusted.trusted_coverage_complete,false);
assert.equal(uncalibratedTrusted.trusted_for_generalization_claim,false);

const trusted=fuseCandidateEvidence({
  required_dimensions:["co2","rain_ingress"],
  provider_results:[trustedContam,trustedRain],
  dimension_weights:{co2:.6,rain_ingress:.4},
  learned_candidate_label:"candidate-3"
});
assert.equal(trusted.decision,"MISALIGNED");
assert.equal(trusted.winner.label,"candidate-2");
assert.equal(trusted.trusted_coverage_complete,true);
assert.equal(trusted.trusted_for_generalization_claim,false);

const trustedAligned=fuseCandidateEvidence({
  required_dimensions:["co2","rain_ingress"],
  provider_results:[trustedContam,trustedRain],
  dimension_weights:{co2:.6,rain_ingress:.4},
  learned_candidate_label:"candidate-2"
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
