"use strict";

const assert=require("assert");
const {summarizePhysicalGeneralization}=require("../scripts/pi_home_generalization_claim.cjs");

const evalResult={
  schema_version:"pi-home-generalization-eval-v1",
  holdout:{cases:4},
  claim:{generalization_reality_delta:true}
};

const partial=summarizePhysicalGeneralization({
  generalization_eval:evalResult,
  alignments:[
    {decision:"COUNTERFACTUAL_CONFIRMED",counterfactual_confirmed:true}
  ],
  min_physical_coverage_ratio:.5,
  min_confirmation_rate:.8
});
assert.equal(partial.label_generalization_supported,true);
assert.equal(partial.physical_generalization_supported,false);
assert.equal(partial.claim_tier,"LABEL_ONLY_GENERALIZATION");
assert.equal(partial.physical_coverage_ratio,.25);

const confirmed=summarizePhysicalGeneralization({
  generalization_eval:evalResult,
  alignments:[
    {decision:"COUNTERFACTUAL_CONFIRMED",counterfactual_confirmed:true},
    {decision:"COUNTERFACTUAL_CONFIRMED",counterfactual_confirmed:true},
    {decision:"COUNTERFACTUAL_CONFIRMED",counterfactual_confirmed:true},
    {decision:"SEMANTIC_PHYSICS_DISAGREEMENT",counterfactual_confirmed:false}
  ],
  min_physical_coverage_ratio:.5,
  min_confirmation_rate:.7
});
assert.equal(confirmed.physical_generalization_supported,true);
assert.equal(confirmed.claim_tier,"PHYSICALLY_CONFIRMED_GENERALIZATION");
assert.equal(confirmed.physical_coverage_ratio,1);
assert.equal(confirmed.physical_confirmation_rate,.75);

const disagreement=summarizePhysicalGeneralization({
  generalization_eval:evalResult,
  alignments:[
    {decision:"COUNTERFACTUAL_CONFIRMED",counterfactual_confirmed:true},
    {decision:"SEMANTIC_PHYSICS_DISAGREEMENT",counterfactual_confirmed:false}
  ],
  min_physical_coverage_ratio:.5,
  min_confirmation_rate:.8
});
assert.equal(disagreement.physical_generalization_supported,false);
assert.equal(disagreement.claim_tier,"LABEL_ONLY_GENERALIZATION");

console.log(JSON.stringify({
  ok:true,
  contract:"physical generalization claims require explicit simulator coverage and confirmation thresholds"
}));
