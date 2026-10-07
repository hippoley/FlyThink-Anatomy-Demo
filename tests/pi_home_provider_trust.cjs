"use strict";

const assert=require("assert");
const {
  buildProviderTrustRegistry,
  buildProviderTrustRegistryV2,
  verifyProviderTrustRegistry,
  resolveProviderTrust,
  applyResolvedTrust
}=require("../scripts/pi_home_provider_trust.cjs");

const digest="sha256:"+"a".repeat(64);
const registry=buildProviderTrustRegistry([{
  provider_id:"contam-engineering",
  status:"active",
  scope_id:"home-profile-v7",
  allowed_dimensions:["co2","airflow"],
  allowed_evidence_levels:["engineering-validated"],
  calibration_ref:"calibration://contam/home-v7",
  calibration_digest:digest,
  approved_by:"engineering-review-board"
}]);

assert.match(registry.registry_digest,/^sha256:[0-9a-f]{64}$/);
assert.equal(verifyProviderTrustRegistry(registry).valid,true);

const provider={
  id:"contam-engineering",
  covered_dimensions:["co2"],
  evidence_level:"engineering-validated",
  trusted_for_promotion:true,
  trust_attestation:{
    scope_id:"home-profile-v7",
    calibration_ref:"calibration://contam/home-v7",
    calibration_digest:digest
  }
};

const ok=resolveProviderTrust(provider,registry);
assert.equal(ok.claimed_trusted_for_promotion,true);
assert.equal(ok.effective_trusted_for_promotion,true);
assert.equal(ok.reason,"registry_attestation_match");
assert.equal(ok.registry_digest,registry.registry_digest);
assert.equal(ok.registry_verification.valid,true);

const noRegistry=resolveProviderTrust(provider,null);
assert.equal(noRegistry.effective_trusted_for_promotion,false);
assert.equal(noRegistry.reason,"trust_registry_missing");

const wrongDigest=resolveProviderTrust({
  ...provider,
  trust_attestation:{...provider.trust_attestation,calibration_digest:"sha256:"+"b".repeat(64)}
},registry);
assert.equal(wrongDigest.effective_trusted_for_promotion,false);
assert.equal(wrongDigest.reason,"provider_calibration_digest_mismatch");

const outOfScope=resolveProviderTrust({
  ...provider,
  covered_dimensions:["co2","rain_ingress"]
},registry);
assert.equal(outOfScope.effective_trusted_for_promotion,false);
assert.equal(outOfScope.reason,"provider_dimension_out_of_scope");

const revoked=buildProviderTrustRegistry([{
  provider_id:"rain-engineering",
  status:"revoked",
  scope_id:"rain-v1",
  allowed_dimensions:["rain_ingress"],
  allowed_evidence_levels:["engineering-validated"],
  calibration_ref:"calibration://rain/v1",
  calibration_digest:"sha256:"+"c".repeat(64),
  approved_by:"engineering-review-board"
}]);
const revokedResult=resolveProviderTrust({
  id:"rain-engineering",
  covered_dimensions:["rain_ingress"],
  evidence_level:"engineering-validated",
  trusted_for_promotion:true,
  trust_attestation:{
    scope_id:"rain-v1",
    calibration_ref:"calibration://rain/v1",
    calibration_digest:"sha256:"+"c".repeat(64)
  }
},revoked);
assert.equal(revokedResult.effective_trusted_for_promotion,false);
assert.equal(revokedResult.reason,"provider_trust_revoked");

const applied=applyResolvedTrust(provider,registry);
assert.equal(applied.claimed_trusted_for_promotion,true);
assert.equal(applied.trusted_for_promotion,true);

console.log(JSON.stringify({
  ok:true,
  contract:"provider trust claims are promotion-effective only when an active external registry entry matches scope, dimensions, evidence level and calibration digest"
}));


const lifecycleRegistry=buildProviderTrustRegistryV2([{
  provider_id:"rain-engineering-v2",
  status:"active",
  scope_id:"rain-home-v2",
  allowed_dimensions:["rain_ingress"],
  allowed_evidence_levels:["engineering-validated"],
  calibration_ref:"calibration://rain/home-v2",
  calibration_digest:"sha256:"+"e".repeat(64),
  approved_by:"engineering-review-board",
  not_before:"2026-10-01T00:00:00Z",
  expires_at:"2026-11-01T00:00:00Z",
  reviewed_at:"2026-10-01T00:00:00Z",
  review_due_at:"2026-10-20T00:00:00Z"
}]);

const lifecycleProvider={
  id:"rain-engineering-v2",
  covered_dimensions:["rain_ingress"],
  evidence_level:"engineering-validated",
  trusted_for_promotion:true,
  trust_attestation:{
    scope_id:"rain-home-v2",
    calibration_ref:"calibration://rain/home-v2",
    calibration_digest:"sha256:"+"e".repeat(64)
  }
};

const lifecycleOk=resolveProviderTrust(
  lifecycleProvider,
  lifecycleRegistry,
  {at:"2026-10-10T12:00:00Z"}
);
assert.equal(lifecycleOk.effective_trusted_for_promotion,true);
assert.equal(lifecycleOk.reason,"registry_attestation_match");
assert.equal(lifecycleOk.evaluation_time,"2026-10-10T12:00:00.000Z");

const notYet=resolveProviderTrust(
  lifecycleProvider,
  lifecycleRegistry,
  {at:"2026-09-30T23:59:59Z"}
);
assert.equal(notYet.effective_trusted_for_promotion,false);
assert.equal(notYet.reason,"provider_trust_not_yet_valid");

const reviewOverdue=resolveProviderTrust(
  lifecycleProvider,
  lifecycleRegistry,
  {at:"2026-10-20T00:00:00Z"}
);
assert.equal(reviewOverdue.effective_trusted_for_promotion,false);
assert.equal(reviewOverdue.reason,"provider_trust_review_overdue");
assert.equal(reviewOverdue.evaluation_time,"2026-10-20T00:00:00.000Z");

const expired=resolveProviderTrust(
  lifecycleProvider,
  lifecycleRegistry,
  {at:"2026-11-01T00:00:00Z"}
);
assert.equal(expired.effective_trusted_for_promotion,false);
assert.equal(expired.reason,"provider_trust_expired");
assert.equal(expired.evaluation_time,"2026-11-01T00:00:00.000Z");

const replayed=applyResolvedTrust(
  lifecycleProvider,
  lifecycleRegistry,
  {at:"2026-10-10T12:00:00Z"}
);
assert.equal(replayed.trusted_for_promotion,true);
assert.equal(replayed.trust_resolution.effective_trusted_for_promotion,true);

assert.throws(
  ()=>buildProviderTrustRegistryV2([{
    provider_id:"bad-window",
    status:"active",
    scope_id:"x",
    allowed_dimensions:["co2"],
    allowed_evidence_levels:["engineering-validated"],
    calibration_ref:"calibration://x",
    calibration_digest:"sha256:"+"f".repeat(64),
    approved_by:"board",
    not_before:"2026-11-01T00:00:00Z",
    expires_at:"2026-10-01T00:00:00Z",
    reviewed_at:"2026-10-01T00:00:00Z",
    review_due_at:"2026-10-20T00:00:00Z"
  }]),
  /expiry_must_follow/
);


assert.throws(
  ()=>buildProviderTrustRegistryV2([{
    provider_id:"review-after-activation",
    status:"active",
    scope_id:"x",
    allowed_dimensions:["co2"],
    allowed_evidence_levels:["engineering-validated"],
    calibration_ref:"calibration://x",
    calibration_digest:"sha256:"+"9".repeat(64),
    approved_by:"board",
    not_before:"2026-10-10T00:00:00Z",
    expires_at:"2026-11-10T00:00:00Z",
    reviewed_at:"2026-10-11T00:00:00Z",
    review_due_at:"2026-10-20T00:00:00Z"
  }]),
  /review_must_not_follow_activation/
);


{
  const tampered=JSON.parse(JSON.stringify(registry));
  tampered.entries["contam-engineering"].approved_by="tampered-reviewer";
  const verification=verifyProviderTrustRegistry(tampered);
  assert.equal(verification.valid,false);
  assert.equal(verification.reason,"provider_trust_registry_digest_mismatch");

  const rejected=resolveProviderTrust(provider,tampered);
  assert.equal(rejected.effective_trusted_for_promotion,false);
  assert.equal(rejected.reason,"provider_trust_registry_digest_mismatch");
  assert.equal(rejected.registry_verification.valid,false);
}

{
  const unsealed=JSON.parse(JSON.stringify(registry));
  delete unsealed.registry_digest;
  const rejected=resolveProviderTrust(provider,unsealed);
  assert.equal(rejected.effective_trusted_for_promotion,false);
  assert.equal(rejected.reason,"provider_trust_registry_digest_missing_or_invalid");
}

{
  assert.match(lifecycleRegistry.registry_digest,/^sha256:[0-9a-f]{64}$/);
  const lifecycleVerified=verifyProviderTrustRegistry(lifecycleRegistry);
  assert.equal(lifecycleVerified.valid,true);
  assert.equal(lifecycleOk.registry_digest,lifecycleRegistry.registry_digest);
}
