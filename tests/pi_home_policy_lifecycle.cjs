"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {PolicyRegistry}=require("../scripts/pi_home_policy_registry.cjs");
const {DecisionEvidenceJournal}=require("../scripts/pi_home_evidence_journal.cjs");
const {PolicyLifecycleOrchestrator}=require("../scripts/pi_home_policy_lifecycle.cjs");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pi-home-lifecycle-"));
const journal=new DecisionEvidenceJournal({file_path:path.join(dir,"evidence.jsonl")});
const registry=new PolicyRegistry({
  policies:[
    {id:"v1",status:"active"},
    {id:"v2",status:"candidate"}
  ],
  active_policy_id:"v1"
});
const lifecycle=new PolicyLifecycleOrchestrator({registry,journal});

const gate={
  schema_version:"pi-home-promotion-gate-v1",
  decision:"POLICY_PROMOTION_AUTHORIZED",
  policy_switch_authorized:true,
  candidate_policy_id:"v2",
  approval:{approved:true,actor:"operator-1"},
  evidence_summary:{total:3,unique_evidence:3,mean_advantage:.5}
};

const promoted=lifecycle.applyPromotionGate(gate);
assert.equal(promoted.changed,true);
assert.equal(registry.active().id,"v2");
assert.equal(promoted.device_execution_authorized,false);
assert.ok(promoted.promotion.event.evidence_ref.startsWith("journal://"));
assert.equal(journal.records[0].type,"PROMOTION_GATE");
assert.equal(journal.records[1].type,"POLICY_PROMOTION");

const {plan}=lifecycle.createCanaryPlan({
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

const {evaluation,event:evaluationEvent}=lifecycle.evaluateCanary(plan,[
  {goal_completed:1,correction_needed:0},
  {goal_completed:0,correction_needed:1,wrong_device:1},
  {goal_completed:1,correction_needed:0}
]);
assert.equal(evaluation.decision,"ABORT_AND_ROLLBACK");

const rolled=lifecycle.applyCanaryEvaluation(evaluation,{actor:"operator-1"});
assert.equal(rolled.changed,true);
assert.equal(registry.active().id,"v1");
assert.equal(rolled.evidence_ref,"journal://"+evaluationEvent.hash);
assert.equal(rolled.device_execution_authorized,false);
assert.equal(journal.records.at(-1).type,"POLICY_ROLLBACK");
assert.equal(journal.verify().count,5);

console.log(JSON.stringify({
  ok:true,
  contract:"promotion -> shadow canary -> rollback is one hash-linked auditable lifecycle"
}));
