"use strict";

const crypto=require("crypto");
const {canonical}=require("./pi_home_evidence_journal.cjs");
const {digestObject}=require("./pi_home_evidence_decision_receipt.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function requireText(v,name){
  if(typeof v!=="string"||!v.trim())throw new Error(name+"_required");
  return v.trim();
}
function normalizeInstant(v,name){
  const text=requireText(v,name);
  const ms=Date.parse(text);
  if(!Number.isFinite(ms))throw new Error(name+"_invalid");
  return new Date(ms).toISOString();
}
function uniq(xs){return [...new Set((xs||[]).map(String))].sort()}

function normalizeAnchorSignerEntry(entry={}){
  const key_id=requireText(entry.key_id,"anchor_signer_key_id");
  const status=String(entry.status||"active");
  if(!["active","revoked"].includes(status)){
    throw new Error("anchor_signer_status_invalid");
  }
  const public_key_pem=requireText(entry.public_key_pem,"anchor_signer_public_key");
  let publicKey;
  try{publicKey=crypto.createPublicKey(public_key_pem)}
  catch(_){throw new Error("anchor_signer_public_key_invalid")}
  if(publicKey.asymmetricKeyType!=="ed25519"){
    throw new Error("anchor_signer_key_must_be_ed25519");
  }
  const allowed_scopes=uniq(entry.allowed_scopes);
  if(!allowed_scopes.length)throw new Error("anchor_signer_scopes_required");
  const not_before=normalizeInstant(entry.not_before,"anchor_signer_not_before");
  const expires_at=normalizeInstant(entry.expires_at,"anchor_signer_expires_at");
  if(Date.parse(expires_at)<=Date.parse(not_before)){
    throw new Error("anchor_signer_expiry_must_follow_not_before");
  }

  let revoked_at=null;
  let revocation_mode=null;
  if(status==="revoked"){
    revoked_at=normalizeInstant(entry.revoked_at,"anchor_signer_revoked_at");
    revocation_mode=String(entry.revocation_mode||"");
    if(!["prospective","retroactive"].includes(revocation_mode)){
      throw new Error("anchor_signer_revocation_mode_required");
    }
  }

  return {
    key_id,
    status,
    purpose:"anchor-seal-signing",
    public_key_pem,
    allowed_scopes,
    not_before,
    expires_at,
    revoked_at,
    revocation_mode,
    metadata:clone(entry.metadata||null)
  };
}

function buildAnchorSignerKeyring(entries=[]){
  const out={};
  for(const raw of entries||[]){
    const entry=normalizeAnchorSignerEntry(raw);
    if(out[entry.key_id])throw new Error("duplicate_anchor_signer_key:"+entry.key_id);
    out[entry.key_id]=entry;
  }
  return {
    schema_version:"pi-home-anchor-signer-keyring-v1",
    entries:out
  };
}

function keyringEntries(keyring){
  if(!keyring||keyring.schema_version!=="pi-home-anchor-signer-keyring-v1"){
    throw new Error("anchor_signer_keyring_required");
  }
  return keyring.entries||{};
}

function attestationCore(attestation={}){
  return {
    schema_version:"pi-home-anchor-attestation-v1",
    algorithm:"Ed25519",
    key_id:attestation.key_id,
    scope_id:attestation.scope_id,
    issued_at:attestation.issued_at,
    anchor_digest:attestation.anchor_digest,
    anchor_generation:attestation.anchor_generation,
    seal_digest:attestation.seal_digest,
    journal_count:attestation.journal_count,
    journal_head_hash:attestation.journal_head_hash,
    receipt_count:attestation.receipt_count
  };
}

function signingBytes(attestation){
  return Buffer.from(canonical(attestationCore(attestation)),"utf8");
}

function buildSignedAnchorAttestation(anchor={},{
  key_id,
  scope_id,
  issued_at,
  private_key_pem
}={}){
  if(!anchor||anchor.schema_version!=="pi-home-receipt-journal-anchor-v1"){
    throw new Error("receipt_journal_anchor_required");
  }
  requireText(anchor.anchor_digest,"receipt_anchor_digest");
  const seal=anchor.seal||{};
  requireText(seal.seal_digest,"receipt_anchor_seal_digest");
  const privatePem=requireText(private_key_pem,"anchor_signer_private_key");
  let privateKey;
  try{privateKey=crypto.createPrivateKey(privatePem)}
  catch(_){throw new Error("anchor_signer_private_key_invalid")}
  if(privateKey.asymmetricKeyType!=="ed25519"){
    throw new Error("anchor_signer_key_must_be_ed25519");
  }

  const core={
    schema_version:"pi-home-anchor-attestation-v1",
    algorithm:"Ed25519",
    key_id:requireText(key_id,"anchor_signer_key_id"),
    scope_id:requireText(scope_id,"anchor_attestation_scope_id"),
    issued_at:normalizeInstant(issued_at,"anchor_attestation_issued_at"),
    anchor_digest:anchor.anchor_digest,
    anchor_generation:Number(anchor.generation),
    seal_digest:seal.seal_digest,
    journal_count:Number(seal.journal_count),
    journal_head_hash:seal.journal_head_hash||null,
    receipt_count:Number(seal.receipt_count)
  };
  if(!Number.isInteger(core.anchor_generation)||core.anchor_generation<1){
    throw new Error("anchor_attestation_generation_invalid");
  }
  if(!Number.isInteger(core.journal_count)||core.journal_count<0){
    throw new Error("anchor_attestation_journal_count_invalid");
  }
  if(!Number.isInteger(core.receipt_count)||core.receipt_count<0){
    throw new Error("anchor_attestation_receipt_count_invalid");
  }
  const signature=crypto.sign(null,Buffer.from(canonical(core),"utf8"),privateKey);
  const attestation={
    ...core,
    signature_base64:signature.toString("base64")
  };
  attestation.attestation_digest=digestObject(attestation);
  return attestation;
}

function resolveAnchorSigner(attestation={},keyring){
  const entries=keyringEntries(keyring);
  const entry=entries[String(attestation.key_id||"")];
  if(!entry){
    return {trusted:false,reason:"anchor_signer_key_not_registered",entry:null};
  }
  if(!entry.allowed_scopes.includes(String(attestation.scope_id||""))){
    return {trusted:false,reason:"anchor_signer_scope_not_allowed",entry:clone(entry)};
  }
  const issued=Date.parse(normalizeInstant(attestation.issued_at,"anchor_attestation_issued_at"));
  if(issued<Date.parse(entry.not_before)){
    return {trusted:false,reason:"anchor_signer_not_yet_valid",entry:clone(entry)};
  }
  if(issued>=Date.parse(entry.expires_at)){
    return {trusted:false,reason:"anchor_signer_expired",entry:clone(entry)};
  }
  if(entry.status==="revoked"){
    if(entry.revocation_mode==="retroactive"){
      return {trusted:false,reason:"anchor_signer_retroactively_revoked",entry:clone(entry)};
    }
    if(issued>=Date.parse(entry.revoked_at)){
      return {trusted:false,reason:"anchor_signer_revoked_at_issue_time",entry:clone(entry)};
    }
  }
  return {trusted:true,reason:"anchor_signer_key_eligible",entry:clone(entry)};
}

function verifySignedAnchorAttestation(attestation={},anchor={},{
  keyring
}={}){
  if(attestation.schema_version!=="pi-home-anchor-attestation-v1"){
    throw new Error("anchor_attestation_schema_invalid");
  }
  if(attestation.algorithm!=="Ed25519"){
    throw new Error("anchor_attestation_algorithm_invalid");
  }
  const declaredDigest=String(attestation.attestation_digest||"");
  const digestCore=clone(attestation);
  delete digestCore.attestation_digest;
  if(declaredDigest!==digestObject(digestCore)){
    throw new Error("anchor_attestation_digest_mismatch");
  }
  if(!anchor||anchor.schema_version!=="pi-home-receipt-journal-anchor-v1"){
    throw new Error("receipt_journal_anchor_required");
  }
  if(attestation.anchor_digest!==anchor.anchor_digest){
    throw new Error("anchor_attestation_anchor_digest_mismatch");
  }
  if(attestation.anchor_generation!==anchor.generation){
    throw new Error("anchor_attestation_generation_mismatch");
  }
  if(attestation.seal_digest!==(anchor.seal&&anchor.seal.seal_digest)){
    throw new Error("anchor_attestation_seal_digest_mismatch");
  }
  if(attestation.journal_count!==(anchor.seal&&anchor.seal.journal_count)){
    throw new Error("anchor_attestation_journal_count_mismatch");
  }
  if(attestation.journal_head_hash!==(anchor.seal&&anchor.seal.journal_head_hash||null)){
    throw new Error("anchor_attestation_journal_head_mismatch");
  }
  if(attestation.receipt_count!==(anchor.seal&&anchor.seal.receipt_count)){
    throw new Error("anchor_attestation_receipt_count_mismatch");
  }

  const signer=resolveAnchorSigner(attestation,keyring);
  if(!signer.trusted){
    return {
      valid_signature:false,
      externally_trusted:false,
      reason:signer.reason,
      signer:signer.entry
    };
  }

  const signature=Buffer.from(requireText(
    attestation.signature_base64,
    "anchor_attestation_signature"
  ),"base64");
  let publicKey;
  try{publicKey=crypto.createPublicKey(signer.entry.public_key_pem)}
  catch(_){throw new Error("anchor_signer_public_key_invalid")}
  const valid=crypto.verify(
    null,
    signingBytes(attestation),
    publicKey,
    signature
  );
  if(!valid){
    throw new Error("anchor_attestation_signature_invalid");
  }
  return {
    valid_signature:true,
    externally_trusted:true,
    reason:"trusted_ed25519_anchor_attestation",
    key_id:attestation.key_id,
    scope_id:attestation.scope_id,
    anchor_digest:attestation.anchor_digest,
    attestation_digest:attestation.attestation_digest,
    signer:signer.entry
  };
}

function verifyExternallyAnchoredJournal({
  journal,
  anchor_store,
  anchor=null,
  attestation,
  keyring
}={}){
  if(!anchor_store||typeof anchor_store.verifyJournal!=="function"){
    throw new Error("receipt_anchor_store_required");
  }
  const selected=anchor||anchor_store.current();
  const journalVerification=anchor_store.verifyJournal(journal,selected);
  const signatureVerification=verifySignedAnchorAttestation(
    attestation,
    selected,
    {keyring}
  );
  if(signatureVerification.externally_trusted!==true){
    return {
      valid:false,
      externally_trusted:false,
      reason:signatureVerification.reason,
      journal:journalVerification,
      signature:signatureVerification,
      device_execution_authorized:false
    };
  }
  return {
    valid:true,
    externally_trusted:true,
    reason:"journal_prefix_matches_trusted_signed_anchor",
    journal:journalVerification,
    signature:signatureVerification,
    device_execution_authorized:false
  };
}

module.exports={
  normalizeAnchorSignerEntry,
  buildAnchorSignerKeyring,
  attestationCore,
  buildSignedAnchorAttestation,
  resolveAnchorSigner,
  verifySignedAnchorAttestation,
  verifyExternallyAnchoredJournal
};
