"use strict";

const assert=require("assert");
const {validateSemanticPhysicsAlignment}=require("../scripts/pi_home_generalization_counterfactual.cjs");

const semantic={
  candidate_ranking:[
    {target:{area:"卧室",entity:"窗户",instance:"south"},score:1},
    {target:{area:"餐厅",entity:"窗户",instance:"west"},score:.5}
  ],
  patches:[{target:{area:"卧室",entity:"窗户",instance:"south"}}]
};

function tournament(target,{trusted=true,complete=true}={}){
  return {
    winner:{
      label:"physical-best",
      outcome:{
        provenance:"counterfactual_simulation",
        trusted_for_promotion:trusted,
        strategy:{
          complete_physics_coverage:complete,
          patches:[{target}]
        },
        result:{end_co2_ppm:850}
      }
    }
  };
}

const aligned=validateSemanticPhysicsAlignment({
  prediction:semantic,
  tournament:tournament({area:"卧室",entity:"窗户",instance:"south"})
});
assert.equal(aligned.decision,"COUNTERFACTUAL_CONFIRMED");
assert.equal(aligned.counterfactual_confirmed,true);
assert.equal(aligned.trusted_for_generalization_claim,true);

const mismatch=validateSemanticPhysicsAlignment({
  prediction:semantic,
  tournament:tournament({area:"餐厅",entity:"窗户",instance:"west"})
});
assert.equal(mismatch.decision,"SEMANTIC_PHYSICS_DISAGREEMENT");
assert.equal(mismatch.counterfactual_confirmed,false);
assert.equal(mismatch.trusted_for_generalization_claim,false);

const partial=validateSemanticPhysicsAlignment({
  prediction:semantic,
  tournament:tournament({area:"卧室",entity:"窗户",instance:"south"},{complete:false})
});
assert.equal(partial.decision,"BLOCKED");
assert.equal(partial.reason,"physical_winner_incomplete_coverage");

const untrusted=validateSemanticPhysicsAlignment({
  prediction:semantic,
  tournament:tournament({area:"卧室",entity:"窗户",instance:"south"},{trusted:false})
});
assert.equal(untrusted.decision,"BLOCKED");
assert.equal(untrusted.reason,"physical_winner_not_trusted");

console.log(JSON.stringify({
  ok:true,
  contract:"label-level generalization counts only when trusted counterfactual physics agrees with the semantic target"
}));
