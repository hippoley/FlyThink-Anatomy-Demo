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
    "SEMANTIC_PHYSICS_DISAGREEMENT"
  ].includes(x.decision));
  const confirmed=evaluated.filter(x=>x.counterfactual_confirmed===true);
  const blocked=(alignments||[]).filter(x=>x&&x.decision==="BLOCKED");
  const coverageRatio=holdoutCases?evaluated.length/holdoutCases:0;
  const confirmationRate=evaluated.length?confirmed.length/evaluated.length:0;
  const labelClaim=generalization_eval.claim&&generalization_eval.claim.generalization_reality_delta===true;
  const physicalClaim=
    labelClaim &&
    coverageRatio>=Number(min_physical_coverage_ratio) &&
    confirmationRate>=Number(min_confirmation_rate);

  return {
    schema_version:"pi-home-generalization-claim-v1",
    label_generalization_supported:labelClaim,
    physical_generalization_supported:physicalClaim,
    holdout_cases:holdoutCases,
    physically_evaluated:evaluated.length,
    physically_confirmed:confirmed.length,
    physical_disagreements:evaluated.length-confirmed.length,
    blocked_physical_cases:blocked.length,
    physical_coverage_ratio:Number(coverageRatio.toFixed(4)),
    physical_confirmation_rate:Number(confirmationRate.toFixed(4)),
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
