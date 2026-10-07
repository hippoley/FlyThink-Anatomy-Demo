"use strict";

const assert=require("assert");
const {
  buildProviderTrustRegistry,
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
