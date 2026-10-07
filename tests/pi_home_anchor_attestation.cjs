"use strict";

const assert=require("assert");
const crypto=require("crypto");
const fs=require("fs");
const os=require("os");
const path=require("path");

const {DecisionEvidenceJournal}=require("../scripts/pi_home_evidence_journal.cjs");
const {buildReceiptJournalSeal}=require("../scripts/pi_home_decision_receipt_ledger.cjs");
const {FileReceiptJournalAnchorStore}=require("../scripts/pi_home_journal_anchor_store.cjs");
const {digestObject}=require("../scripts/pi_home_evidence_decision_receipt.cjs");
const {
  buildAnchorSignerKeyring,
  buildSignedAnchorAttestation,
  verifySignedAnchorAttestation,
  verifyExternallyAnchoredJournal
}=require("../scripts/pi_home_anchor_attestation.cjs");

const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
const publicPem=publicKey.export({type:"spki",format:"pem"});
const privatePem=privateKey.export({type:"pkcs8",format:"pem"});

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pi-home-signed-anchor-"));
const journalPath=path.join(dir,"evidence.jsonl");
const anchorPath=path.join(dir,"anchors.jsonl");

const journal=new DecisionEvidenceJournal({file_path:journalPath});
journal.append({
  type:"EVIDENCE_DECISION_RECEIPT",
  actor:"home-policy-shadow",
  refs:{decision_id:"decision-001"},
  payload:{decision_id:"decision-001",receipt_digest:"sha256:"+"a".repeat(64)}
});

const store=new FileReceiptJournalAnchorStore({file_path:anchorPath});
const anchor=store.publish(buildReceiptJournalSeal(journal),{
  published_at:"2026-10-07T03:00:00Z",
  actor:"anchor-service",
  reason:"external checkpoint"
});

const keyring=buildAnchorSignerKeyring([{
  key_id:"anchor-key-2026-q4",
  status:"active",
  public_key_pem:publicPem,
  allowed_scopes:["home-evidence-primary"],
  not_before:"2026-10-01T00:00:00Z",
  expires_at:"2026-11-01T00:00:00Z"
}]);

const attestation=buildSignedAnchorAttestation(anchor,{
  key_id:"anchor-key-2026-q4",
  scope_id:"home-evidence-primary",
  issued_at:"2026-10-07T03:01:00Z",
  private_key_pem:privatePem
});

assert.match(attestation.attestation_digest,/^sha256:[0-9a-f]{64}$/);
assert.equal(attestation.algorithm,"Ed25519");
assert.equal(attestation.anchor_digest,anchor.anchor_digest);

const verified=verifySignedAnchorAttestation(attestation,anchor,{keyring});
assert.equal(verified.valid_signature,true);
assert.equal(verified.externally_trusted,true);
assert.equal(verified.key_id,"anchor-key-2026-q4");

const external=verifyExternallyAnchoredJournal({
  journal,
  anchor_store:store,
  anchor,
  attestation,
  keyring
});
assert.equal(external.valid,true);
assert.equal(external.externally_trusted,true);
assert.equal(external.journal.unanchored_journal_count,0);
assert.equal(external.device_execution_authorized,false);

// New journal records after the signed anchor are explicit unanchored suffixes.
journal.append({
  type:"POST_ANCHOR_EVENT",
  actor:"system",
  payload:{value:2}
});
const withTail=verifyExternallyAnchoredJournal({
  journal,
  anchor_store:store,
  anchor,
  attestation,
  keyring
});
assert.equal(withTail.valid,true);
assert.equal(withTail.journal.anchored_journal_count,1);
assert.equal(withTail.journal.current_journal_count,2);
assert.equal(withTail.journal.unanchored_journal_count,1);

// Wrong scope never becomes externally trusted.
const wrongScopeKeyring=buildAnchorSignerKeyring([{
  key_id:"anchor-key-2026-q4",
  status:"active",
  public_key_pem:publicPem,
  allowed_scopes:["other-scope"],
  not_before:"2026-10-01T00:00:00Z",
  expires_at:"2026-11-01T00:00:00Z"
}]);
const wrongScope=verifySignedAnchorAttestation(attestation,anchor,{keyring:wrongScopeKeyring});
assert.equal(wrongScope.externally_trusted,false);
assert.equal(wrongScope.reason,"anchor_signer_scope_not_allowed");

// Expired keys cannot validate attestations issued after expiry.
const lateAttestation=buildSignedAnchorAttestation(anchor,{
  key_id:"anchor-key-2026-q4",
  scope_id:"home-evidence-primary",
  issued_at:"2026-11-02T00:00:00Z",
  private_key_pem:privatePem
});
const expired=verifySignedAnchorAttestation(lateAttestation,anchor,{keyring});
assert.equal(expired.externally_trusted,false);
assert.equal(expired.reason,"anchor_signer_expired");

// Prospective revoke preserves historical signatures issued before revocation.
const prospectiveKeyring=buildAnchorSignerKeyring([{
  key_id:"anchor-key-2026-q4",
  status:"revoked",
  public_key_pem:publicPem,
  allowed_scopes:["home-evidence-primary"],
  not_before:"2026-10-01T00:00:00Z",
  expires_at:"2026-11-01T00:00:00Z",
  revoked_at:"2026-10-08T00:00:00Z",
  revocation_mode:"prospective"
}]);
const historical=verifySignedAnchorAttestation(attestation,anchor,{keyring:prospectiveKeyring});
assert.equal(historical.externally_trusted,true);

const postRevokeAttestation=buildSignedAnchorAttestation(anchor,{
  key_id:"anchor-key-2026-q4",
  scope_id:"home-evidence-primary",
  issued_at:"2026-10-09T00:00:00Z",
  private_key_pem:privatePem
});
const postRevoke=verifySignedAnchorAttestation(
  postRevokeAttestation,
  anchor,
  {keyring:prospectiveKeyring}
);
assert.equal(postRevoke.externally_trusted,false);
assert.equal(postRevoke.reason,"anchor_signer_revoked_at_issue_time");

// Retroactive revoke invalidates historical signatures too.
const retroactiveKeyring=buildAnchorSignerKeyring([{
  key_id:"anchor-key-2026-q4",
  status:"revoked",
  public_key_pem:publicPem,
  allowed_scopes:["home-evidence-primary"],
  not_before:"2026-10-01T00:00:00Z",
  expires_at:"2026-11-01T00:00:00Z",
  revoked_at:"2026-10-08T00:00:00Z",
  revocation_mode:"retroactive"
}]);
const retroactive=verifySignedAnchorAttestation(attestation,anchor,{keyring:retroactiveKeyring});
assert.equal(retroactive.externally_trusted,false);
assert.equal(retroactive.reason,"anchor_signer_retroactively_revoked");

// Signature bytes cannot be replaced even if the attacker recomputes the
// unsigned attestation digest.
const forged=JSON.parse(JSON.stringify(attestation));
const sig=Buffer.from(forged.signature_base64,"base64");
sig[0]^=0xff;
forged.signature_base64=sig.toString("base64");
const forgedCore={...forged};
delete forgedCore.attestation_digest;
forged.attestation_digest=digestObject(forgedCore);
assert.throws(
  ()=>verifySignedAnchorAttestation(forged,anchor,{keyring}),
  /signature_invalid/
);

// An attestation is bound to one exact anchor generation/digest.
const anchor2=store.publish(buildReceiptJournalSeal(journal),{
  published_at:"2026-10-07T03:05:00Z",
  actor:"anchor-service",
  reason:"next checkpoint"
});
assert.equal(anchor2.generation,2);
assert.throws(
  ()=>verifySignedAnchorAttestation(attestation,anchor2,{keyring}),
  /anchor_digest_mismatch/
);

assert.throws(
  ()=>buildAnchorSignerKeyring([{
    key_id:"not-ed25519",
    status:"active",
    public_key_pem:crypto.generateKeyPairSync("rsa",{modulusLength:2048}).publicKey.export({
      type:"spki",
      format:"pem"
    }),
    allowed_scopes:["home-evidence-primary"],
    not_before:"2026-10-01T00:00:00Z",
    expires_at:"2026-11-01T00:00:00Z"
  }]),
  /must_be_ed25519/
);

console.log(JSON.stringify({
  ok:true,
  contract:"external journal anchors become trusted only with valid Ed25519 attestations from eligible scoped signer keys; revocation semantics are explicit"
}));
