"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");

const {
  DecisionEvidenceJournal,
  verifyEvidenceRecords
}=require("../scripts/pi_home_evidence_journal.cjs");
const {
  buildReceiptJournalSeal
}=require("../scripts/pi_home_decision_receipt_ledger.cjs");
const {
  FileReceiptJournalAnchorStore
}=require("../scripts/pi_home_journal_anchor_store.cjs");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pi-home-anchor-"));
const journalPath=path.join(dir,"evidence.jsonl");
const anchorPath=path.join(dir,"anchors.jsonl");

// Two stale in-memory instances must still serialize against disk head.
const j1=new DecisionEvidenceJournal({file_path:journalPath});
const j2=new DecisionEvidenceJournal({file_path:journalPath});

const a=j1.append({
  type:"TEST_A",
  actor:"system",
  payload:{value:1}
});
assert.equal(a.sequence,1);

const b=j2.append({
  type:"TEST_B",
  actor:"system",
  payload:{value:2}
});
assert.equal(b.sequence,2);
assert.equal(b.prev_hash,a.hash);

j1.refresh();
assert.equal(j1.verify().count,2);
assert.equal(j1.records[1].hash,b.hash);
assert.equal(verifyEvidenceRecords(j1.records).ok,true);

// Existing lock is fail-closed; journal never guesses whether a lock is stale.
fs.writeFileSync(journalPath+".lock","held","utf8");
assert.throws(
  ()=>j1.append({type:"LOCKED",payload:{}}),
  /evidence_journal_lock_busy/
);
fs.unlinkSync(journalPath+".lock");

// Anchor store instances may also be stale but must serialize their generations.
const storeA=new FileReceiptJournalAnchorStore({file_path:anchorPath});
const storeB=new FileReceiptJournalAnchorStore({file_path:anchorPath});

const seal1=buildReceiptJournalSeal(j1);
const anchor1=storeA.publish(seal1,{
  published_at:"2026-10-07T03:00:00Z",
  actor:"evidence-anchor",
  reason:"checkpoint after TEST_B"
});
assert.equal(anchor1.generation,1);
assert.equal(anchor1.seal.journal_count,2);

const c=j1.append({
  type:"TEST_C",
  actor:"system",
  payload:{value:3}
});
assert.equal(c.sequence,3);

const seal2=buildReceiptJournalSeal(j1);
const anchor2=storeB.publish(seal2,{
  published_at:"2026-10-07T03:01:00Z",
  actor:"evidence-anchor",
  reason:"checkpoint after TEST_C"
});
assert.equal(anchor2.generation,2);
assert.equal(anchor2.previous_anchor_digest,anchor1.anchor_digest);
assert.equal(anchor2.seal.journal_count,3);

assert.throws(
  ()=>storeA.publish(seal2,{
    published_at:"2026-10-07T03:02:00Z",
    actor:"evidence-anchor",
    reason:"duplicate checkpoint"
  }),
  /requires_journal_advance/
);

// Current anchor verifies exact anchored prefix.
const anchored=storeA.verifyJournal(j1);
assert.equal(anchored.valid,true);
assert.equal(anchored.anchored_journal_count,3);
assert.equal(anchored.current_journal_count,3);
assert.equal(anchored.unanchored_journal_count,0);

// New unanchored events are allowed and reported explicitly.
j2.append({
  type:"TEST_D",
  actor:"system",
  payload:{value:4}
});
const withTail=storeA.verifyJournal(j2);
assert.equal(withTail.valid,true);
assert.equal(withTail.anchored_journal_count,3);
assert.equal(withTail.current_journal_count,4);
assert.equal(withTail.unanchored_journal_count,1);

// Publish a third anchor over the latest journal state.
const seal3=buildReceiptJournalSeal(j2);
const anchor3=storeA.publish(seal3,{
  published_at:"2026-10-07T03:03:00Z",
  actor:"evidence-anchor",
  reason:"checkpoint after TEST_D"
});
assert.equal(anchor3.generation,3);
assert.equal(anchor3.seal.journal_count,4);

// Truncating an anchored tail leaves a syntactically valid prefix but violates
// the external anchor.
const lines=fs.readFileSync(journalPath,"utf8").trim().split(/\r?\n/);
fs.writeFileSync(journalPath,lines.slice(0,-1).join("\n")+"\n","utf8");
const truncated=new DecisionEvidenceJournal({file_path:journalPath});
assert.equal(truncated.verify().count,3);
assert.throws(
  ()=>storeA.verifyJournal(truncated),
  /anchored_journal_truncated/
);

// Anchor lock is also fail-closed.
fs.writeFileSync(anchorPath+".lock","held","utf8");
assert.throws(
  ()=>storeA.publish(buildReceiptJournalSeal(truncated),{
    published_at:"2026-10-07T03:04:00Z",
    actor:"evidence-anchor",
    reason:"should fail"
  }),
  /evidence_journal_lock_busy/
);
fs.unlinkSync(anchorPath+".lock");

// Anchor tampering is detected independently from journal verification.
const anchorLines=fs.readFileSync(anchorPath,"utf8").trim().split(/\r?\n/);
const tampered=JSON.parse(anchorLines[0]);
tampered.reason="quietly rewritten";
anchorLines[0]=JSON.stringify(tampered);
fs.writeFileSync(anchorPath,anchorLines.join("\n")+"\n","utf8");
assert.throws(
  ()=>new FileReceiptJournalAnchorStore({file_path:anchorPath}),
  /receipt_anchor_digest_mismatch/
);

console.log(JSON.stringify({
  ok:true,
  contract:"journal appends serialize on disk head; external anchor chain detects anchored tail truncation while allowing explicit unanchored suffixes"
}));
