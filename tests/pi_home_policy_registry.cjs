"use strict";

const assert=require("assert");
const {PolicyRegistry}=require("../scripts/pi_home_policy_registry.cjs");

const registry=new PolicyRegistry({
  policies:[
    {id:"home-policy-v1",artifact_ref:"artifact://v1",status:"active"},
    {id:"home-policy-v2",artifact_ref:"artifact://v2"}
  ],
  active_policy_id:"home-policy-v1"
});

assert.equal(registry.active().id,"home-policy-v1");
assert.equal(registry.get("home-policy-v2").status,"candidate");

assert.throws(
  ()=>new PolicyRegistry({
    policies:[
      {id:"a",status:"active"},
      {id:"b",status:"active"}
    ]
  }),
  /multiple_active_policies_declared/
);

assert.throws(
  ()=>registry.promote({
    schema_version:"pi-home-promotion-gate-v1",
    decision:"AWAIT_HUMAN_APPROVAL",
    policy_switch_authorized:false,
    candidate_policy_id:"home-policy-v2"
  }),
  /not_authorized/
);

const promoted=registry.promote({
  schema_version:"pi-home-promotion-gate-v1",
  decision:"POLICY_PROMOTION_AUTHORIZED",
  policy_switch_authorized:true,
  candidate_policy_id:"home-policy-v2",
  approval:{approved:true,actor:"operator-1"},
  evidence_summary:{total:5,candidates:5,mean_advantage:.4}
},{evidence_ref:"evidence://promotion-1"});

assert.equal(promoted.changed,true);
assert.equal(promoted.active_policy_id,"home-policy-v2");
assert.equal(promoted.previous_policy_id,"home-policy-v1");
assert.equal(promoted.device_execution_authorized,false);
assert.equal(registry.get("home-policy-v1").status,"inactive");
assert.equal(registry.get("home-policy-v2").status,"active");

const rolled=registry.rollback({
  actor:"operator-1",
  reason:"shadow regression detected",
  evidence_ref:"evidence://regression-1"
});
assert.equal(rolled.active_policy_id,"home-policy-v1");
assert.equal(rolled.rolled_back_policy_id,"home-policy-v2");
assert.equal(rolled.device_execution_authorized,false);
assert.equal(registry.get("home-policy-v2").status,"rolled_back");
assert.equal(registry.snapshot().history.length,2);

console.log(JSON.stringify({
  ok:true,
  contract:"policy promotion is versioned, auditable and rollback-safe without authorizing device execution"
}));
