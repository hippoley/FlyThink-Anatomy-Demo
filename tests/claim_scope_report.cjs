"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildClaimScopeReport}=require("../scripts/claim_scope_report.cjs");

function base(){
  return {
    authorization_receipt_integrity_verified:true,
    authorization_receipt_patches_verified:true,
    authorization_patch_digest_verified:true,
    authorization_id_verified:true,
    authorization_single_use_verified:true,
    authorization_case_id_verified:true,
    authorization_source_step_verified:true,
    authorization_source_revision_verified:true,
    authorization_binding_verified:true,
    logical_target_binding_verified:true,
    target_binding_verified:true,
    ack_verified:true,
    measured_readback_verified:true,
    physical_truth_verified:false,
    physical_completion_verified:false
  };
}

test("controller ACK never upgrades itself into physical completion",()=>{
  const out=buildClaimScopeReport(base());
  assert.equal(out.claims.execution_authorization.status,"VERIFIED");
  assert.equal(out.claims.authorization_trust_domain.status,"UNVERIFIED");
  assert.equal(out.claims.authorization_issuer.status,"UNVERIFIED");
  assert.equal(out.claims.controller_report.status,"VERIFIED");
  assert.equal(out.claims.physical_effect.status,"INDETERMINATE");
});

test("authorization can verify while downstream and physical claims fail",()=>{
  const v=base();
  v.ack_verified=false;
  v.measured_readback_verified=false;
  const out=buildClaimScopeReport(v);
  assert.equal(out.claims.execution_authorization.status,"VERIFIED");
  assert.equal(out.claims.authorization_trust_domain.status,"UNVERIFIED");
  assert.equal(out.claims.authorization_issuer.status,"UNVERIFIED");
  assert.equal(out.claims.controller_report.status,"NOT_VERIFIED");
  assert.equal(out.claims.physical_effect.status,"NOT_VERIFIED");
});

test("physical completion is reported only from explicit completion verification",()=>{
  const v=base();
  v.physical_truth_verified=true;
  v.physical_completion_verified=true;
  const out=buildClaimScopeReport(v);
  assert.equal(out.claims.physical_effect.status,"VERIFIED");
  assert.match(out.claims.physical_effect.proves,/precommitted criterion/);
  assert.equal(out.claims.independent_object_outcome.status,"UNVERIFIED");
  assert.ok(
    out.claims.physical_effect.does_not_prove.includes(
      "the object-level outcome was independently observed outside the controller/readback path"
    )
  );
});

test("record integrity does not imply named-human or issuer authentication",()=>{
  const out=buildClaimScopeReport(base());
  assert.ok(out.claims.execution_record.does_not_prove.includes("a named human approved the action"));
  assert.ok(out.claims.execution_authorization.does_not_prove.includes("a named human approved the action"));
  assert.ok(out.claims.execution_authorization.does_not_prove.includes("the authorization trust domain or configured signing-key source was externally verified"));
  assert.equal(out.claims.authorization_trust_domain.status,"UNVERIFIED");
  assert.equal(out.claims.authorization_issuer.status,"UNVERIFIED");
});

test("caller input cannot mint authorization issuer authenticity",()=>{
  const v=base();
  v.authorization_issuer_authenticated_verified=true;
  const out=buildClaimScopeReport(v);
  assert.equal(out.claims.execution_authorization.status,"VERIFIED");
  assert.equal(out.claims.authorization_trust_domain.status,"UNVERIFIED");
  assert.equal(out.claims.authorization_issuer.status,"UNVERIFIED");
});

test("caller input cannot mint authorization trust-domain key-source verification",()=>{
  const v=base();
  v.authorization_trust_domain_key_source_verified=true;
  const out=buildClaimScopeReport(v);
  assert.equal(out.claims.execution_authorization.status,"VERIFIED");
  assert.equal(out.claims.authorization_trust_domain.status,"UNVERIFIED");
  assert.equal(out.claims.authorization_issuer.status,"UNVERIFIED");
});


test("caller input cannot mint independent object-level outcome verification",()=>{
  const v=base();
  v.physical_truth_verified=true;
  v.physical_completion_verified=true;
  v.independent_object_outcome_verified=true;
  const out=buildClaimScopeReport(v);
  assert.equal(out.claims.physical_effect.status,"VERIFIED");
  assert.equal(out.claims.independent_object_outcome.status,"UNVERIFIED");
});
