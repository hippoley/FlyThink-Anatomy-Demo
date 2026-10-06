"use strict";

const assert=require("assert");
const {PolicyRegistry}=require("../scripts/pi_home_policy_registry.cjs");
const {applyCanaryDecision}=require("../scripts/pi_home_canary_rollback.cjs");

function promotedRegistry(){
  const registry=new PolicyRegistry({
    policies:[
      {id:"v1",status:"active"},
      {id:"v2",status:"candidate"}
    ],
    active_policy_id:"v1"
  });
  registry.promote({
    schema_version:"pi-home-promotion-gate-v1",
    decision:"POLICY_PROMOTION_AUTHORIZED",
    policy_switch_authorized:true,
    candidate_policy_id:"v2",
    approval:{approved:true,actor:"operator"}
  },{evidence_ref:"evidence://promotion"});
  return registry;
}

const registry=promotedRegistry();
const noop=applyCanaryDecision({
  registry,
  actor:"operator",
  canary_evaluation:{
    schema_version:"pi-home-canary-evaluation-v1",
    decision:"CONTINUE_SHADOW",
    rollback_recommended:false
  }
});
assert.equal(noop.changed,false);
assert.equal(noop.active_policy_id,"v2");

const out=applyCanaryDecision({
  registry,
  actor:"operator",
  evidence_ref:"evidence://canary-failure",
  canary_evaluation:{
    schema_version:"pi-home-canary-evaluation-v1",
    decision:"ABORT_AND_ROLLBACK",
    rollback_recommended:true
  }
});
assert.equal(out.changed,true);
assert.equal(out.action,"ROLLED_BACK");
assert.equal(out.active_policy_id,"v1");
assert.equal(out.device_execution_authorized,false);
assert.equal(registry.snapshot().history.at(-1).type,"ROLLBACK");
assert.equal(registry.snapshot().history.at(-1).evidence_ref,"evidence://canary-failure");

const invalid=promotedRegistry();
assert.throws(
  ()=>applyCanaryDecision({
    registry:invalid,
    actor:"operator",
    canary_evaluation:{
      schema_version:"pi-home-canary-evaluation-v1",
      decision:"ABORT_AND_ROLLBACK",
      rollback_recommended:false
    }
  }),
  /abort_without_rollback/
);

console.log(JSON.stringify({
  ok:true,
  contract:"only explicit canary abort may trigger audited policy rollback"
}));
