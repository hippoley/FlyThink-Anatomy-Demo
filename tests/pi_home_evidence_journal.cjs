"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {DecisionEvidenceJournal}=require("../scripts/pi_home_evidence_journal.cjs");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pi-home-journal-"));
const file=path.join(dir,"evidence.jsonl");

const journal=new DecisionEvidenceJournal({file_path:file});
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

assert.equal(a.sequence,1);
assert.equal(b.prev_hash,a.hash);
assert.equal(c.prev_hash,b.hash);
assert.equal(journal.verify().count,3);
assert.equal(journal.verify().head_hash,c.hash);

const reopened=new DecisionEvidenceJournal({file_path:file});
assert.equal(reopened.verify().count,3);
assert.equal(reopened.snapshot().records[2].actor,"operator-1");

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
