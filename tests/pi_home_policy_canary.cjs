"use strict";

const assert=require("assert");
const {buildCanaryPlan,evaluateCanary}=require("../scripts/pi_home_policy_canary.cjs");

const registry={
  schema_version:"pi-home-policy-registry-v1",
  active_policy_id:"home-policy-v2",
  policies:{
    "home-policy-v1":{id:"home-policy-v1",status:"inactive"},
    "home-policy-v2":{id:"home-policy-v2",status:"active"}
  },
  history:[
    {type:"PROMOTION",sequence:1,from:"home-policy-v1",to:"home-policy-v2"}
  ]
};

const plan=buildCanaryPlan({
  registry_snapshot:registry,
  min_cases:3,
  thresholds:{
    unsafe_execute:0,
    wrong_device:0,
    untouched_state_violation:0,
    min_goal_completion_rate:.9,
    max_correction_rate:.1
  }
});
assert.equal(plan.mode,"shadow_only");
assert.equal(plan.real_device_traffic_fraction,0);
assert.equal(plan.device_execution_authorized,false);
assert.equal(plan.control_policy_id,"home-policy-v1");

const continueShadow=evaluateCanary(plan,[
  {goal_completed:1,correction_needed:0}
]);
assert.equal(continueShadow.decision,"CONTINUE_SHADOW");

const ready=evaluateCanary(plan,[
  {goal_completed:1,correction_needed:0},
  {goal_completed:1,correction_needed:0},
  {goal_completed:1,correction_needed:0}
]);
assert.equal(ready.decision,"READY_FOR_HUMAN_REVIEW");
assert.equal(ready.device_execution_authorized,false);

const abort=evaluateCanary(plan,[
  {goal_completed:1,correction_needed:0},
  {goal_completed:0,correction_needed:1,wrong_device:1},
  {goal_completed:1,correction_needed:0}
]);
assert.equal(abort.decision,"ABORT_AND_ROLLBACK");
assert.equal(abort.rollback_recommended,true);
assert.equal(abort.device_execution_authorized,false);

const hold=evaluateCanary(plan,[
  {goal_completed:1,correction_needed:0},
  {goal_completed:0,correction_needed:1},
  {goal_completed:1,correction_needed:0}
]);
assert.equal(hold.decision,"HOLD_SHADOW");
assert.equal(hold.rollback_recommended,false);

console.log(JSON.stringify({
  ok:true,
  contract:"canary is shadow-only; safety violations demand rollback and success still requires human review"
}));
