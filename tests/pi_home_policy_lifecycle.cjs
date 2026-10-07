"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {PolicyRegistry}=require("../scripts/pi_home_policy_registry.cjs");
const {DecisionEvidenceJournal}=require("../scripts/pi_home_evidence_journal.cjs");
const {PolicyLifecycleOrchestrator}=require("../scripts/pi_home_policy_lifecycle.cjs");
const {buildEvidenceDecisionReceipt}=require("../scripts/pi_home_evidence_decision_receipt.cjs");
const {createTrustRegistrySnapshot}=require("../scripts/pi_home_provider_trust_lineage.cjs");
const {resolveProviderTrust}=require("../scripts/pi_home_provider_trust.cjs");

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

assert.throws(
  ()=>lifecycle.applyCanaryEvaluation(
    {...evaluation,reason:"tampered"},
    {actor:"operator-1"}
  ),
  /evidence_mismatch/
);

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


{
  const receiptJournal=new DecisionEvidenceJournal({
    file_path:path.join(dir,"receipt-backed-evidence.jsonl")
  });
  const receiptRegistry=new PolicyRegistry({
    policies:[
      {id:"receipt-v1",status:"active"},
      {id:"receipt-v2",status:"candidate"}
    ],
    active_policy_id:"receipt-v1"
  });
  const receiptLifecycle=new PolicyLifecycleOrchestrator({
    registry:receiptRegistry,
    journal:receiptJournal
  });
  const trustSnapshot=createTrustRegistrySnapshot([{
    provider_id:"rain-engineering-v1",
    status:"active",
    scope_id:"rain-home-v1",
    allowed_dimensions:["rain_ingress"],
    allowed_evidence_levels:["engineering-validated"],
    calibration_ref:"calibration://rain/v1",
    calibration_digest:"sha256:"+"a".repeat(64),
    approved_by:"engineering-review-board",
    not_before:"2026-10-01T00:00:00Z",
    expires_at:"2026-11-01T00:00:00Z",
    reviewed_at:"2026-10-01T00:00:00Z",
    review_due_at:"2026-10-20T00:00:00Z"
  }],{
    changed_at:"2026-10-01T00:00:00Z",
    changed_by:"operator-1",
    change_reason:"initial approval",
    change_id:"receipt-trust-001"
  });
  const trust=resolveProviderTrust({
    id:"rain-engineering-v1",
    covered_dimensions:["rain_ingress"],
    evidence_level:"engineering-validated",
    trusted_for_promotion:true,
    trust_attestation:{
      scope_id:"rain-home-v1",
      calibration_ref:"calibration://rain/v1",
      calibration_digest:"sha256:"+"a".repeat(64)
    }
  },trustSnapshot.registry,{at:"2026-10-10T00:00:00Z"});
  const learnedCandidate={label:"candidate-3"};
  const providerResults=[{
    id:"rain-engineering-v1",
    evidence_level:"engineering-validated",
    trusted_for_promotion:true,
    dimensions:{
      rain_ingress:{
        direction:"min",
        scores:{"candidate-1":.8,"candidate-3":.1}
      }
    }
  }];
  const adjudication={
    schema_version:"pi-home-multiphysics-fusion-v1",
    decision:"ALIGNED",
    by_dimension:{
      rain_ingress:{
        trusted:true,
        providers:[{
          id:"rain-engineering-v1",
          trusted_for_promotion:true,
          trust_resolution:trust
        }]
      }
    },
    winner:{label:"candidate-3",score:1},
    trusted_coverage_complete:true,
    trusted_for_generalization_claim:true
  };
  const receipt=buildEvidenceDecisionReceipt({
    decision_id:"receipt-backed-decision-001",
    evaluated_at:"2026-10-10T00:00:00Z",
    actor:"shadow-policy",
    learned_candidate:learnedCandidate,
    adjudication,
    provider_results:providerResults,
    trust_snapshot:trustSnapshot
  });
  const receiptContext={
    learned_candidate:learnedCandidate,
    adjudication,
    provider_results:providerResults,
    trust_snapshot:trustSnapshot
  };
  const receiptGate={
    schema_version:"pi-home-promotion-gate-v1",
    decision:"POLICY_PROMOTION_AUTHORIZED",
    policy_switch_authorized:true,
    candidate_policy_id:"receipt-v2",
    approval:{approved:true,actor:"operator-1"},
    evidence_summary:{
      total:3,
      unique_evidence:3,
      mean_advantage:.5,
      decision_receipt_digest:receipt.receipt_digest
    }
  };
  const receiptPromotion=receiptLifecycle.applyReceiptBackedPromotionGate(
    receiptGate,
    {receipt,receipt_context:receiptContext}
  );
  assert.equal(receiptPromotion.changed,true);
  assert.equal(receiptRegistry.active().id,"receipt-v2");
  assert.equal(receiptPromotion.receipt_verification.valid,true);
  assert.equal(receiptPromotion.receipt_event.type,"EVIDENCE_DECISION_RECEIPT");
  assert.equal(
    receiptPromotion.promotion.event.evidence_ref,
    "journal://"+receiptPromotion.receipt_event.hash
  );
  assert.equal(
    receiptPromotion.promotion_event.refs.evidence,
    "journal://"+receiptPromotion.receipt_event.hash
  );
  assert.equal(receiptPromotion.device_execution_authorized,false);

  const mismatchRegistry=new PolicyRegistry({
    policies:[
      {id:"mismatch-v1",status:"active"},
      {id:"mismatch-v2",status:"candidate"}
    ],
    active_policy_id:"mismatch-v1"
  });
  const mismatchJournal=new DecisionEvidenceJournal({
    file_path:path.join(dir,"mismatch-evidence.jsonl")
  });
  const mismatchLifecycle=new PolicyLifecycleOrchestrator({
    registry:mismatchRegistry,
    journal:mismatchJournal
  });
  assert.throws(
    ()=>mismatchLifecycle.applyReceiptBackedPromotionGate({
      ...receiptGate,
      candidate_policy_id:"mismatch-v2",
      evidence_summary:{
        ...receiptGate.evidence_summary,
        decision_receipt_digest:"sha256:"+"f".repeat(64)
      }
    },{receipt,receipt_context:receiptContext}),
    /receipt_digest_mismatch/
  );
  assert.equal(mismatchJournal.records.length,0);
  assert.equal(mismatchRegistry.active().id,"mismatch-v1");

  const screeningReceipt={
    ...receipt,
    trusted_for_generalization_claim:false
  };
  screeningReceipt.receipt_digest=require("../scripts/pi_home_evidence_decision_receipt.cjs")
    .digestObject({
      schema_version:"pi-home-evidence-decision-receipt-v1",
      decision_id:screeningReceipt.decision_id,
      evaluated_at:screeningReceipt.evaluated_at,
      actor:screeningReceipt.actor,
      learned_candidate_digest:screeningReceipt.learned_candidate_digest,
      adjudication_digest:screeningReceipt.adjudication_digest,
      provider_evidence_digests:screeningReceipt.provider_evidence_digests,
      trust_snapshot:screeningReceipt.trust_snapshot,
      trusted_for_generalization_claim:false,
      device_execution_authorized:false
    });
  assert.throws(
    ()=>mismatchLifecycle.applyReceiptBackedPromotionGate({
      ...receiptGate,
      candidate_policy_id:"mismatch-v2",
      evidence_summary:{
        ...receiptGate.evidence_summary,
        decision_receipt_digest:screeningReceipt.receipt_digest
      }
    },{receipt:screeningReceipt,receipt_context:receiptContext}),
    /trusted_generalization_receipt_required/
  );
  assert.equal(mismatchJournal.records.length,0);
}
