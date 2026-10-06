"use strict";

const assert=require("assert");
const {buildLearnedPhysicsClaim}=require("../scripts/pi_home_learned_physics_gate.cjs");

const learned={
  schema_version:"pi-home-learned-checkpoint-shadow-eval-v1",
  shadow_only:true,
  cases:2,
  exact:1,
  exact_replay_hits:0,
  device_execution_authorized:false,
  rows:[
    {
      id:"a",
      predicted:{area:"餐厅",entity:"窗户",instance:"default"},
      ranking:[{target:{area:"餐厅",entity:"窗户",instance:"default"},score:1}]
    },
    {
      id:"b",
      predicted:{area:"书房",entity:"窗户",instance:"south"},
      ranking:[{target:{area:"书房",entity:"窗户",instance:"south"},score:1}]
    }
  ]
};

function tournament(target){
  return {
    winner:{
      label:"physical-best",
      outcome:{
        provenance:"counterfactual_simulation",
        trusted_for_promotion:true,
        strategy:{
          complete_physics_coverage:true,
          patches:[{target}]
        }
      }
    }
  };
}

const noPhysics=buildLearnedPhysicsClaim({learned_eval:learned});
assert.equal(noPhysics.claim.claim_tier,"LABEL_ONLY_GENERALIZATION");
assert.equal(noPhysics.claim.physical_generalization_supported,false);
assert.equal(noPhysics.alignments.every(x=>x.reason==="physical_evidence_missing"),true);

const confirmed=buildLearnedPhysicsClaim({
  learned_eval:learned,
  tournaments_by_case:{
    a:tournament({area:"餐厅",entity:"窗户",instance:"default"}),
    b:tournament({area:"书房",entity:"窗户",instance:"south"})
  },
  min_physical_coverage_ratio:1,
  min_confirmation_rate:1
});
assert.equal(confirmed.claim.claim_tier,"PHYSICALLY_CONFIRMED_GENERALIZATION");
assert.equal(confirmed.claim.physical_generalization_supported,true);
assert.equal(confirmed.device_execution_authorized,false);

const mismatch=buildLearnedPhysicsClaim({
  learned_eval:learned,
  tournaments_by_case:{
    a:tournament({area:"阳台",entity:"窗户",instance:"default"}),
    b:tournament({area:"书房",entity:"窗户",instance:"south"})
  },
  min_physical_coverage_ratio:1,
  min_confirmation_rate:1
});
assert.equal(mismatch.claim.claim_tier,"LABEL_ONLY_GENERALIZATION");
assert.equal(mismatch.claim.physical_confirmation_rate,.5);

console.log(JSON.stringify({
  ok:true,
  contract:"learned checkpoint stays label-only until trusted complete counterfactual physics confirms sufficient holdout coverage"
}));
