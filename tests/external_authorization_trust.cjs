"use strict";

const assert=require("assert");
const {
  digestObject,
  buildExternalAuthorizationTrustBinding,
  validateExternalAuthorizationTrustVerdict,
  verifyRetainedExternalAuthorizationEvidence
}=require("../scripts/external_authorization_trust.cjs");

const B={area:"主卧",entity:"空调",instance:"default"};
const action={op:"PATCH_SLOT",target:B,slot:"temperature",value:19};
const receipt={
  patch_digest:"a".repeat(64),
  registry_digest:"b".repeat(64)
};
const completion=[{
  criterion:{kind:"slot_equals",slot:"temperature",value:19},
  criterion_sha256:"c".repeat(64)
}];

function binding(){
  return buildExternalAuthorizationTrustBinding({
    authorized_actions:[action],
    authorization_receipt:receipt,
    completion_criteria:completion,
    world_snapshot_revision:7,
    world_snapshot_sha256:"d".repeat(64)
  });
}
function verdict(overrides={}){
  const b=binding();
  return {
    schema_version:"flythink-external-authorization-trust-verdict.v1",
    provider:"external-test",
    provider_revision:"rev-1",
    transaction_id:"txn-1",
    token_sha256:"e".repeat(64),
    trust_anchor_sha256:"f".repeat(64),
    trust_anchor_source:"deployment:test",
    binding_sha256:digestObject(b),
    cryptographic_validation_verified:true,
    trust_domain_key_source_verified:true,
    issuer_authenticated_verified:false,
    required_claims_verified:true,
    flythink_profile_binding_verified:true,
    ready_for_canonical_execution:true,
    offline_reverifiable:false,
    ...overrides
  };
}

{
  const b=binding();
  const evidence=validateExternalAuthorizationTrustVerdict(verdict(),b);
  assert.equal(evidence.runtime_enforced,true);
  assert.equal(evidence.trust_domain_key_source_verified_at_runtime,true);
  assert.equal(evidence.issuer_authenticated_at_runtime,false);
  assert.equal(evidence.offline_reverifiable,false);
  const retained=verifyRetainedExternalAuthorizationEvidence(evidence,b);
  assert.equal(retained.bound,true);
  assert.equal(retained.runtime_enforced_recorded,true);
  assert.equal(retained.offline_reverifiable,false);
}

{
  assert.throws(
    ()=>validateExternalAuthorizationTrustVerdict(
      verdict({binding_sha256:"0".repeat(64)}),
      binding()
    ),
    /binding_mismatch/
  );
}

{
  assert.throws(
    ()=>validateExternalAuthorizationTrustVerdict(
      verdict({trust_domain_key_source_verified:false}),
      binding()
    ),
    /trust_domain_unverified/
  );
}

{
  assert.throws(
    ()=>validateExternalAuthorizationTrustVerdict(
      verdict({issuer_authenticated_verified:false}),
      binding(),
      {require_issuer:true}
    ),
    /issuer_unverified/
  );
}

{
  const b=binding();
  const evidence=validateExternalAuthorizationTrustVerdict(
    verdict({issuer_authenticated_verified:true}),
    b,
    {require_issuer:true}
  );
  assert.equal(evidence.issuer_authenticated_at_runtime,true);
}

{
  const b=binding();
  const evidence=validateExternalAuthorizationTrustVerdict(verdict(),b);
  const tampered=JSON.parse(JSON.stringify(evidence));
  tampered.binding.world_snapshot_sha256="1".repeat(64);
  assert.throws(
    ()=>verifyRetainedExternalAuthorizationEvidence(tampered,b),
    /binding_digest_mismatch/
  );
}

{
  assert.throws(
    ()=>buildExternalAuthorizationTrustBinding({
      authorized_actions:[action],
      authorization_receipt:receipt,
      completion_criteria:completion,
      world_snapshot_revision:7,
      world_snapshot_sha256:null
    }),
    /world_sha256_required/
  );
}

console.log(JSON.stringify({
  ok:true,
  contract:"provider-neutral external authorization verdict is exact-binding, fail-closed, and separates runtime enforcement from offline re-verifiability"
}));
