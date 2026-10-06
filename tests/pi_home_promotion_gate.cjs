"use strict";

const assert=require("assert");
const {evaluatePromotionGate}=require("../scripts/pi_home_promotion_gate.cjs");

function evidence(id,adv=.5){
  return {
    schema_version:"pi-home-strategy-promotion-evidence-v1",
    decision:"SHADOW_PROMOTION_CANDIDATE",
    reason:"trusted_counterfactual_advantage",
    tournament_request_id:id,
    winner_label:"cross-room",
    estimated_advantage:adv,
    execution_authorized:false
  };
}

const records=[evidence("a",.5),evidence("b",.4),evidence("c",.6)];

const waiting=evaluatePromotionGate(records,{
  min_cases:3,
  min_mean_advantage:.2,
  max_blocked_fraction:0,
  candidate_policy_id:"home-policy-v2"
});
assert.equal(waiting.decision,"AWAIT_HUMAN_APPROVAL");
assert.equal(waiting.evidence_ready,true);
assert.equal(waiting.policy_switch_authorized,false);
assert.equal(waiting.device_execution_authorized,false);

const approved=evaluatePromotionGate(records,{
  min_cases:3,
  min_mean_advantage:.2,
  candidate_policy_id:"home-policy-v2",
  approval:{approved:true,actor:"operator-1",scope:"home-policy-v2"}
});
assert.equal(approved.decision,"POLICY_PROMOTION_AUTHORIZED");
assert.equal(approved.policy_switch_authorized,true);
assert.equal(approved.device_execution_authorized,false);
assert.equal(approved.approval.actor,"operator-1");

const insufficient=evaluatePromotionGate(records.slice(0,2),{
  min_cases:3,
  approval:{approved:true,actor:"operator-1"}
});
assert.equal(insufficient.decision,"HOLD_SHADOW");
assert.equal(insufficient.policy_switch_authorized,false);

const blocked=evaluatePromotionGate([
  ...records,
  {
    schema_version:"pi-home-strategy-promotion-evidence-v1",
    decision:"BLOCKED",
    reason:"current_outcome_not_trusted"
  }
],{
  min_cases:3,
  min_mean_advantage:.2,
  max_blocked_fraction:0
});
assert.equal(blocked.decision,"HOLD_SHADOW");

console.log(JSON.stringify({
  ok:true,
  contract:"policy promotion requires aggregate evidence and explicit human approval; device execution stays separate"
}));
