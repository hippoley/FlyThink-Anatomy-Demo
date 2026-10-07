"use strict";

const assert=require("assert");
const {
  buildEvidenceCoverage,
  adjudicateEvidence,
  adjudicateCandidateEvidence
}=require("../scripts/pi_home_evidence_adjudicator.cjs");

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
  trusted_for_promotion:true
};

const trustedContam={
  ...contam,
  id:"contam-engineering",
  evidence_level:"engineering-validated",
  trusted_for_promotion:true
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
    physical_candidate_comparison_available:true
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


{
  const contamScores={
    id:"contam-demo",
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
  const rainScores={
    id:"rain-screening",
    kind:"heuristic-screening",
    evidence_level:"feature-derived-screening",
    trusted_for_promotion:false,
    dimensions:{
      rain_ingress:{
        direction:"min",
        scores:{
          "candidate-1":.8,
          "candidate-2":.25,
          "candidate-3":.1
        }
      }
    }
  };
  const screening=adjudicateCandidateEvidence({
    required_dimensions:["co2","rain_ingress"],
    provider_results:[contamScores,rainScores],
    learned_candidate_label:"candidate-3",
    dimension_weights:{co2:.6,rain_ingress:.4}
  });
  assert.equal(screening.decision,"SCREENING_ALIGNED");
  assert.equal(screening.winner.label,"candidate-3");
  assert.equal(screening.coverage.coverage_complete,true);
  assert.equal(screening.coverage.trusted_coverage_complete,false);
  assert.equal(screening.trusted_for_generalization_claim,false);

  const trusted=adjudicateCandidateEvidence({
    required_dimensions:["co2","rain_ingress"],
    provider_results:[
      {
        ...contamScores,
        id:"contam-engineering",
        evidence_level:"engineering-validated",
        trusted_for_promotion:true,
        calibration:{status:"validated",validation_id:"contam-cal-v1",covered_dimensions:["co2"]}
      },
      {
        ...rainScores,
        id:"rain-engineering",
        evidence_level:"engineering-validated",
        trusted_for_promotion:true,
        calibration:{status:"validated",validation_id:"rain-cal-v1",covered_dimensions:["rain_ingress"]}
      }
    ],
    learned_candidate_label:"candidate-3",
    dimension_weights:{co2:.6,rain_ingress:.4}
  });
  assert.equal(trusted.decision,"ALIGNED");
  assert.equal(trusted.coverage.trusted_coverage_complete,true);
  assert.equal(trusted.trusted_for_generalization_claim,true);

  const missing=adjudicateCandidateEvidence({
    required_dimensions:["co2","rain_ingress"],
    provider_results:[contamScores],
    learned_candidate_label:"candidate-2"
  });
  assert.equal(missing.decision,"NOT_ADJUDICABLE");
  assert.equal(missing.trusted_for_generalization_claim,false);
}
