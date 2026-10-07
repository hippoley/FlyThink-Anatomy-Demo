"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");

const {DecisionEvidenceJournal}=require("../scripts/pi_home_evidence_journal.cjs");
const {
  EvidenceDecisionReceiptLedger,
  buildReceiptJournalSeal,
  verifyReceiptJournalSeal
}=require("../scripts/pi_home_decision_receipt_ledger.cjs");
const {
  buildEvidenceDecisionReceipt,
  verifyEvidenceDecisionReceipt
}=require("../scripts/pi_home_evidence_decision_receipt.cjs");
const {
  createTrustRegistrySnapshot,
  revokeProvider
}=require("../scripts/pi_home_provider_trust_lineage.cjs");
const {resolveProviderTrust}=require("../scripts/pi_home_provider_trust.cjs");

function makeFixture(){
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
  const trust=resolveProviderTrust(provider,snapshot.registry,{at:"2026-10-10T00:00:00Z"});
  const learnedCandidate={
    label:"candidate-3",
    target:{area:"书房",entity:"窗户",instance:"south"}
  };
  const providerResults=[{
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
  return {
    snapshot,
    learnedCandidate,
    providerResults,
    adjudication,
    receipt,
    verificationContext:{
      learned_candidate:learnedCandidate,
      adjudication,
      provider_results:providerResults,
      trust_snapshot:snapshot,
      trust_lineage:[snapshot]
    }
  };
}

const fixture=makeFixture();
assert.equal(
  verifyEvidenceDecisionReceipt(fixture.receipt,fixture.verificationContext).valid,
  true
);

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pi-home-receipt-ledger-"));
const file=path.join(dir,"evidence.jsonl");
const journal=new DecisionEvidenceJournal({file_path:file});
journal.append({
  type:"PROMOTION_GATE",
  actor:"operator-1",
  payload:{decision:"POLICY_PROMOTION_AUTHORIZED"},
  refs:{policy:"v2"}
});

const ledger=new EvidenceDecisionReceiptLedger({journal});
const committed=ledger.appendVerifiedReceipt(
  fixture.receipt,
  fixture.verificationContext
);
assert.equal(committed.verified.valid,true);
assert.equal(committed.event.type,"EVIDENCE_DECISION_RECEIPT");
assert.equal(committed.event.payload.receipt_digest,fixture.receipt.receipt_digest);
assert.equal(committed.device_execution_authorized,false);
assert.equal(committed.seal.journal_count,2);
assert.equal(committed.seal.receipt_count,1);
assert.equal(ledger.verifySeal(committed.seal).valid,true);
assert.equal(ledger.snapshot().receipt_index[0].decision_id,"decision-001");

assert.throws(
  ()=>ledger.appendVerifiedReceipt(fixture.receipt,fixture.verificationContext),
  /duplicate_decision_id/
);

const secondReceipt=buildEvidenceDecisionReceipt({
  decision_id:"decision-002",
  evaluated_at:"2026-10-10T00:00:00Z",
  actor:"home-policy-shadow",
  learned_candidate:fixture.learnedCandidate,
  adjudication:fixture.adjudication,
  provider_results:fixture.providerResults,
  trust_snapshot:fixture.snapshot,
  trust_lineage:[fixture.snapshot]
});
const secondContext={
  ...fixture.verificationContext
};
const second=ledger.appendVerifiedReceipt(secondReceipt,secondContext);
assert.equal(second.seal.journal_count,3);
assert.equal(second.seal.receipt_count,2);
const finalSeal=second.seal;

const tamperedSeal=JSON.parse(JSON.stringify(finalSeal));
tamperedSeal.receipt_count=999;
assert.throws(
  ()=>verifyReceiptJournalSeal(journal,tamperedSeal),
  /seal_digest_mismatch/
);

// Tail truncation remains a syntactically valid hash chain, so the external seal
// must detect that the ledger is incomplete.
const lines=fs.readFileSync(file,"utf8").trim().split(/\r?\n/);
fs.writeFileSync(file,lines.slice(0,-1).join("\n")+"\n","utf8");
const truncatedJournal=new DecisionEvidenceJournal({file_path:file});
assert.equal(truncatedJournal.verify().count,2);
assert.throws(
  ()=>verifyReceiptJournalSeal(truncatedJournal,finalSeal),
  /seal_count_mismatch/
);

// Duplicate receipt digests in historical journal data are rejected even if
// the underlying hash chain itself is structurally valid.
const duplicateFile=path.join(dir,"duplicate.jsonl");
const duplicateJournal=new DecisionEvidenceJournal({file_path:duplicateFile});
duplicateJournal.append({
  type:"EVIDENCE_DECISION_RECEIPT",
  actor:"home-policy-shadow",
  refs:{decision_id:"decision-a"},
  payload:{
    ...fixture.receipt,
    decision_id:"decision-a"
  }
});
duplicateJournal.append({
  type:"EVIDENCE_DECISION_RECEIPT",
  actor:"home-policy-shadow",
  refs:{decision_id:"decision-b"},
  payload:{
    ...fixture.receipt,
    decision_id:"decision-b"
  }
});
assert.throws(
  ()=>new EvidenceDecisionReceiptLedger({journal:duplicateJournal}),
  /duplicate_receipt_digest/
);

// A later revocation does not invalidate the historical receipt itself, but the
// receipt ledger still verifies it against the full current lineage.
const revoked=revokeProvider(fixture.snapshot,"rain-engineering-v1",{
  changed_at:"2026-10-12T00:00:00Z",
  changed_by:"operator-2",
  reason:"calibration drift",
  change_id:"registry-change-002"
});
assert.equal(
  verifyEvidenceDecisionReceipt(fixture.receipt,{
    ...fixture.verificationContext,
    trust_lineage:[fixture.snapshot,revoked]
  }).valid,
  true
);

console.log(JSON.stringify({
  ok:true,
  contract:"verified decision receipts are unique journal events; external seals detect tail truncation and historical duplicate replay"
}));
