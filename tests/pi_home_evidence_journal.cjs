"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {DecisionEvidenceJournal}=require("../scripts/pi_home_evidence_journal.cjs");
const {buildEvidenceDecisionReceipt}=require("../scripts/pi_home_evidence_decision_receipt.cjs");
const {createTrustRegistrySnapshot}=require("../scripts/pi_home_provider_trust_lineage.cjs");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pi-home-journal-"));
const file=path.join(dir,"evidence.jsonl");

const journal=new DecisionEvidenceJournal({file_path:file});

const trustSnapshot=createTrustRegistrySnapshot([],{
  changed_at:"2026-10-10T00:00:00Z",
  changed_by:"system",
  change_reason:"screening receipt test snapshot",
  change_id:"journal-test-snapshot-001"
});
const receiptCandidate={label:"candidate-3"};
const receiptAdjudication={
  schema_version:"pi-home-multiphysics-fusion-v1",
  decision:"SCREENING_ALIGNED",
  by_dimension:{},
  winner:{label:"candidate-3",score:1},
  learned_candidate_label:"candidate-3",
  trusted_coverage_complete:false,
  trusted_for_generalization_claim:false
};
const receipt=buildEvidenceDecisionReceipt({
  decision_id:"journal-decision-001",
  evaluated_at:"2026-10-10T00:00:00Z",
  actor:"shadow-policy",
  learned_candidate:receiptCandidate,
  adjudication:receiptAdjudication,
  provider_results:[],
  trust_snapshot:trustSnapshot
});
const receiptWrite=journal.appendDecisionReceipt(receipt,{
  learned_candidate:receiptCandidate,
  adjudication:receiptAdjudication,
  provider_results:[],
  trust_snapshot:trustSnapshot
});
assert.equal(receiptWrite.verification.valid,true);
assert.equal(receiptWrite.record.type,"EVIDENCE_DECISION_RECEIPT");
assert.equal(receiptWrite.record.refs.receipt_digest,receipt.receipt_digest);
assert.equal(receiptWrite.record.refs.registry_digest,trustSnapshot.registry.registry_digest);
assert.equal(receiptWrite.record.refs.snapshot_digest,trustSnapshot.snapshot_digest);

const tamperedReceipt={...receipt,decision_id:"journal-decision-tampered"};
assert.throws(
  ()=>journal.appendDecisionReceipt(tamperedReceipt,{
    learned_candidate:receiptCandidate,
    adjudication:receiptAdjudication,
    provider_results:[],
    trust_snapshot:trustSnapshot
  }),
  /receipt_digest_mismatch/
);
assert.equal(journal.records.length,1);
const a=journal.append({
  type:"PROMOTION_EVIDENCE",
  actor:"system",
  refs:{policy:"v2"},
  payload:{decision:"SHADOW_PROMOTION_CANDIDATE",estimated_advantage:.4}
});
const b=journal.append({
  type:"CANARY_EVALUATION",
  actor:"system",
  refs:{policy:"v2"},
  payload:{decision:"ABORT_AND_ROLLBACK",wrong_device:1}
});
const c=journal.append({
  type:"POLICY_ROLLBACK",
  actor:"operator-1",
  refs:{from:"v2",to:"v1"},
  payload:{reason:"canary safety invariant failed"}
});

assert.equal(a.sequence,2);
assert.equal(a.prev_hash,receiptWrite.record.hash);
assert.equal(b.prev_hash,a.hash);
assert.equal(c.prev_hash,b.hash);
assert.equal(journal.verify().count,4);
assert.equal(journal.verify().head_hash,c.hash);

const reopened=new DecisionEvidenceJournal({file_path:file});
assert.equal(reopened.verify().count,4);
assert.equal(reopened.snapshot().records[3].actor,"operator-1");

const lines=fs.readFileSync(file,"utf8").trim().split(/\r?\n/);
const tampered=JSON.parse(lines[0]);
tampered.payload.estimated_advantage=9.9;
lines[0]=JSON.stringify(tampered);
fs.writeFileSync(file,lines.join("\n")+"\n","utf8");
assert.throws(
  ()=>new DecisionEvidenceJournal({file_path:file}),
  /journal_hash_mismatch/
);

console.log(JSON.stringify({
  ok:true,
  contract:"promotion/canary/rollback evidence is persisted in a tamper-evident hash chain"
}));
