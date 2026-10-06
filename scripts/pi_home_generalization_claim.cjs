"use strict";

function summarizePhysicalGeneralization({
  generalization_eval,
  alignments=[],
  min_physical_coverage_ratio=0.5,
  min_confirmation_rate=0.8
}={}){
  if(!generalization_eval||generalization_eval.schema_version!=="pi-home-generalization-eval-v1"){
    throw new Error("generalization_eval_required");
  }
  const holdoutCases=Number(generalization_eval.holdout&&generalization_eval.holdout.cases||0);
  const evaluated=(alignments||[]).filter(x=>x&&[
    "COUNTERFACTUAL_CONFIRMED",
    "SEMANTIC_PHYSICS_DISAGREEMENT",
    "ALIGNED",
    "MISALIGNED"
  ].includes(x.decision));
  const isConfirmed=x=>
    x&&(
      x.counterfactual_confirmed===true ||
      (x.decision==="ALIGNED"&&x.semantic_physics_aligned===true)
    );
  const isTrusted=x=>
    x&&(
      ["COUNTERFACTUAL_CONFIRMED","SEMANTIC_PHYSICS_DISAGREEMENT"].includes(x.decision) ||
      x.coverage&&x.coverage.trusted_coverage_complete===true
    );
  const confirmed=evaluated.filter(isConfirmed);
  const trustedEvaluated=evaluated.filter(isTrusted);
  const trustedConfirmed=trustedEvaluated.filter(isConfirmed);
  const blocked=(alignments||[]).filter(x=>x&&x.decision==="BLOCKED");
  const notAdjudicable=(alignments||[]).filter(x=>x&&x.decision==="NOT_ADJUDICABLE");
  const coverageRatio=holdoutCases?evaluated.length/holdoutCases:0;
  const confirmationRate=evaluated.length?confirmed.length/evaluated.length:0;
  const trustedCoverageRatio=holdoutCases?trustedEvaluated.length/holdoutCases:0;
  const trustedConfirmationRate=trustedEvaluated.length?trustedConfirmed.length/trustedEvaluated.length:0;
  const labelClaim=generalization_eval.claim&&generalization_eval.claim.generalization_reality_delta===true;
  const physicalClaim=
    labelClaim &&
    trustedCoverageRatio>=Number(min_physical_coverage_ratio) &&
    trustedConfirmationRate>=Number(min_confirmation_rate);

  return {
    schema_version:"pi-home-generalization-claim-v1",
    label_generalization_supported:labelClaim,
    physical_generalization_supported:physicalClaim,
    holdout_cases:holdoutCases,
    physically_evaluated:evaluated.length,
    physically_confirmed:confirmed.length,
    physical_disagreements:evaluated.length-confirmed.length,
    trusted_physically_evaluated:trustedEvaluated.length,
    trusted_physically_confirmed:trustedConfirmed.length,
    blocked_physical_cases:blocked.length,
    not_adjudicable_physical_cases:notAdjudicable.length,
    physical_coverage_ratio:Number(coverageRatio.toFixed(4)),
    physical_confirmation_rate:Number(confirmationRate.toFixed(4)),
    trusted_physical_coverage_ratio:Number(trustedCoverageRatio.toFixed(4)),
    trusted_physical_confirmation_rate:Number(trustedConfirmationRate.toFixed(4)),
    thresholds:{
      min_physical_coverage_ratio:Number(min_physical_coverage_ratio),
      min_confirmation_rate:Number(min_confirmation_rate)
    },
    claim_tier:physicalClaim
      ?"PHYSICALLY_CONFIRMED_GENERALIZATION"
      :(labelClaim?"LABEL_ONLY_GENERALIZATION":"NO_GENERALIZATION_CLAIM")
  };
}

module.exports={summarizePhysicalGeneralization};
