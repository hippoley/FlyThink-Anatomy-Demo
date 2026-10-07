"use strict";

const assert=require("assert");
const {
  buildEvidenceDecisionReceipt,
  verifyEvidenceDecisionReceipt
}=require("../scripts/pi_home_evidence_decision_receipt.cjs");
const {
  createTrustRegistrySnapshot,
  revokeProvider
}=require("../scripts/pi_home_provider_trust_lineage.cjs");
const {
  resolveProviderTrust
}=require("../scripts/pi_home_provider_trust.cjs");

const snapshot=createTrustRegistrySnapshot([{
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
  change_id:"registry-change-001"
});

const provider={
  id:"rain-engineering-v1",
  covered_dimensions:["rain_ingress"],
  evidence_level:"engineering-validated",
  trusted_for_promotion:true,
  trust_attestation:{
    scope_id:"rain-home-v1",
    calibration_ref:"calibration://rain/v1",
    calibration_digest:"sha256:"+"a".repeat(64)
  }
};
const trust=resolveProviderTrust(
  provider,
  snapshot.registry,
  {at:"2026-10-10T00:00:00Z"}
);
assert.equal(trust.effective_trusted_for_promotion,true);

const learnedCandidate={
  label:"candidate-3",
  target:{area:"书房",entity:"窗户",instance:"south"}
};
const providerResults=[
  {
    id:"rain-engineering-v1",
    kind:"engineering-model",
    evidence_level:"engineering-validated",
    trusted_for_promotion:true,
    trust_attestation:provider.trust_attestation,
    dimensions:{
      rain_ingress:{
        direction:"min",
        scores:{"candidate-1":.8,"candidate-2":.3,"candidate-3":.1}
      }
    }
  }
];
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
  learned_candidate_label:"candidate-3",
  trusted_coverage_complete:true,
  trusted_for_generalization_claim:true
};

const receipt=buildEvidenceDecisionReceipt({
  decision_id:"decision-001",
  evaluated_at:"2026-10-10T00:00:00Z",
  actor:"home-policy-shadow",
  learned_candidate:learnedCandidate,
  adjudication,
  provider_results:providerResults,
  trust_snapshot:snapshot,
  trust_lineage:[snapshot]
});
assert.match(receipt.receipt_digest,/^sha256:[0-9a-f]{64}$/);
assert.equal(receipt.trust_snapshot.revision,1);
assert.equal(receipt.trust_snapshot.registry_digest,snapshot.registry.registry_digest);
assert.equal(receipt.trust_snapshot.snapshot_digest,snapshot.snapshot_digest);
assert.equal(receipt.trusted_for_generalization_claim,true);
assert.equal(receipt.device_execution_authorized,false);

const verified=verifyEvidenceDecisionReceipt(receipt,{
  learned_candidate:learnedCandidate,
  adjudication,
  provider_results:providerResults,
  trust_snapshot:snapshot,
  trust_lineage:[snapshot]
});
assert.equal(verified.valid,true);
assert.equal(verified.receipt_digest,receipt.receipt_digest);

assert.throws(
  ()=>verifyEvidenceDecisionReceipt(receipt,{
    learned_candidate:{...learnedCandidate,label:"candidate-2"},
    adjudication,
    provider_results:providerResults,
    trust_snapshot:snapshot,
    trust_lineage:[snapshot]
  }),
  /candidate_mismatch/
);

const tamperedEvidence=JSON.parse(JSON.stringify(providerResults));
tamperedEvidence[0].dimensions.rain_ingress.scores["candidate-3"]=.9;
assert.throws(
  ()=>verifyEvidenceDecisionReceipt(receipt,{
    learned_candidate:learnedCandidate,
    adjudication,
    provider_results:tamperedEvidence,
    trust_snapshot:snapshot,
    trust_lineage:[snapshot]
  }),
  /provider_evidence_mismatch/
);

const tamperedAdjudication=JSON.parse(JSON.stringify(adjudication));
tamperedAdjudication.winner.label="candidate-2";
assert.throws(
  ()=>verifyEvidenceDecisionReceipt(receipt,{
    learned_candidate:learnedCandidate,
    adjudication:tamperedAdjudication,
    provider_results:providerResults,
    trust_snapshot:snapshot,
    trust_lineage:[snapshot]
  }),
  /adjudication_mismatch/
);

const wrongSnapshot=JSON.parse(JSON.stringify(snapshot));
wrongSnapshot.change_reason="tampered snapshot";
assert.throws(
  ()=>verifyEvidenceDecisionReceipt(receipt,{
    learned_candidate:learnedCandidate,
    adjudication,
    provider_results:providerResults,
    trust_snapshot:wrongSnapshot,
    trust_lineage:[snapshot]
  }),
  /snapshot_digest_mismatch/
);

const mismatchAdjudication=JSON.parse(JSON.stringify(adjudication));
mismatchAdjudication.by_dimension.rain_ingress.providers[0].trust_resolution.registry_digest=
  "sha256:"+"f".repeat(64);
assert.throws(
  ()=>buildEvidenceDecisionReceipt({
    decision_id:"decision-bad",
    evaluated_at:"2026-10-10T00:00:00Z",
    actor:"home-policy-shadow",
    learned_candidate:learnedCandidate,
    adjudication:mismatchAdjudication,
    provider_results:providerResults,
    trust_snapshot:snapshot,
    trust_lineage:[snapshot]
  }),
  /trust_snapshot_mismatch/
);

const screeningAdjudication={
  schema_version:"pi-home-multiphysics-fusion-v1",
  decision:"SCREENING_ALIGNED",
  by_dimension:{},
  winner:{label:"candidate-3",score:1},
  learned_candidate_label:"candidate-3",
  trusted_coverage_complete:false,
  trusted_for_generalization_claim:false
};
const screeningReceipt=buildEvidenceDecisionReceipt({
  decision_id:"decision-screening",
  evaluated_at:"2026-10-10T00:00:00Z",
  actor:"home-policy-shadow",
  learned_candidate:learnedCandidate,
  adjudication:screeningAdjudication,
  provider_results:[],
  trust_snapshot:snapshot
});
assert.equal(screeningReceipt.trusted_for_generalization_claim,false);
assert.equal(screeningReceipt.device_execution_authorized,false);

console.log(JSON.stringify({
  ok:true,
  contract:"decision receipts bind candidate, provider evidence, adjudication and exact trust-registry snapshot without authorizing device execution"
}));


const wrongTimeAdjudication=JSON.parse(JSON.stringify(adjudication));
wrongTimeAdjudication.by_dimension.rain_ingress.providers[0].trust_resolution.evaluation_time=
  "2026-10-09T00:00:00Z";
assert.throws(
  ()=>buildEvidenceDecisionReceipt({
    decision_id:"decision-time-mismatch",
    evaluated_at:"2026-10-10T00:00:00Z",
    actor:"home-policy-shadow",
    learned_candidate:learnedCandidate,
    adjudication:wrongTimeAdjudication,
    provider_results:providerResults,
    trust_snapshot:snapshot,
    trust_lineage:[snapshot]
  }),
  /evaluation_time_mismatch/
);


const revokedSnapshot=revokeProvider(snapshot,"rain-engineering-v1",{
  changed_at:"2026-10-12T00:00:00Z",
  changed_by:"operator-2",
  reason:"calibration drift",
  change_id:"registry-change-002"
});

assert.throws(
  ()=>buildEvidenceDecisionReceipt({
    decision_id:"decision-no-lineage",
    evaluated_at:"2026-10-10T00:00:00Z",
    actor:"home-policy-shadow",
    learned_candidate:learnedCandidate,
    adjudication,
    provider_results:providerResults,
    trust_snapshot:snapshot
  }),
  /trust_lineage_required/
);

assert.throws(
  ()=>buildEvidenceDecisionReceipt({
    decision_id:"decision-stale-snapshot",
    evaluated_at:"2026-10-13T00:00:00Z",
    actor:"home-policy-shadow",
    learned_candidate:learnedCandidate,
    adjudication,
    provider_results:providerResults,
    trust_snapshot:snapshot,
    trust_lineage:[snapshot,revokedSnapshot]
  }),
  /snapshot_stale_at_evaluation_time/
);

const historicalReceipt=buildEvidenceDecisionReceipt({
  decision_id:"decision-before-revoke",
  evaluated_at:"2026-10-10T00:00:00Z",
  actor:"home-policy-shadow",
  learned_candidate:learnedCandidate,
  adjudication,
  provider_results:providerResults,
  trust_snapshot:snapshot,
  trust_lineage:[snapshot,revokedSnapshot]
});
assert.equal(historicalReceipt.trust_lineage_head.revision,2);
assert.equal(
  verifyEvidenceDecisionReceipt(historicalReceipt,{
    learned_candidate:learnedCandidate,
    adjudication,
    provider_results:providerResults,
    trust_snapshot:snapshot,
    trust_lineage:[snapshot,revokedSnapshot]
  }).valid,
  true
);

assert.throws(
  ()=>verifyEvidenceDecisionReceipt(historicalReceipt,{
    learned_candidate:learnedCandidate,
    adjudication,
    provider_results:providerResults,
    trust_snapshot:snapshot,
    trust_lineage:[snapshot]
  }),
  /lineage_head_/
);
