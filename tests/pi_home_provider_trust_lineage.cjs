"use strict";

const assert=require("assert");
const {
  createTrustRegistrySnapshot,
  evolveTrustRegistrySnapshot,
  verifyTrustRegistrySnapshot,
  verifyTrustRegistryLineage,
  revokeProvider,
  renewProvider
}=require("../scripts/pi_home_provider_trust_lineage.cjs");
const {resolveProviderTrust}=require("../scripts/pi_home_provider_trust.cjs");

function entry(overrides={}){
  return {
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
    review_due_at:"2026-10-20T00:00:00Z",
    ...overrides
  };
}
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

const v1=createTrustRegistrySnapshot([entry()],{
  changed_at:"2026-10-01T00:00:00Z",
  changed_by:"operator-1",
  change_reason:"initial calibration approval",
  change_id:"trust-change-001"
});
assert.equal(v1.revision,1);
assert.equal(v1.previous_registry_digest,null);
assert.equal(verifyTrustRegistrySnapshot(v1).valid,true);
assert.equal(resolveProviderTrust(provider,v1.registry,{at:"2026-10-10T00:00:00Z"}).effective_trusted_for_promotion,true);

const v2=renewProvider(v1,"rain-engineering-v1",{
  expires_at:"2026-12-01T00:00:00Z",
  reviewed_at:"2026-10-15T00:00:00Z",
  review_due_at:"2026-11-15T00:00:00Z",
  changed_at:"2026-10-15T00:00:00Z",
  changed_by:"operator-2",
  reason:"measured recalibration passed",
  change_id:"trust-change-002"
});
assert.equal(v2.revision,2);
assert.equal(v2.previous_registry_digest,v1.registry.registry_digest);
assert.notEqual(v2.registry.registry_digest,v1.registry.registry_digest);
assert.equal(resolveProviderTrust(provider,v2.registry,{at:"2026-11-01T00:00:00Z"}).effective_trusted_for_promotion,true);

const v3=revokeProvider(v2,"rain-engineering-v1",{
  changed_at:"2026-11-05T00:00:00Z",
  changed_by:"operator-3",
  reason:"sensor calibration drift",
  change_id:"trust-change-003"
});
assert.equal(v3.revision,3);
assert.equal(v3.registry.entries["rain-engineering-v1"].status,"revoked");
const revoked=resolveProviderTrust(provider,v3.registry,{at:"2026-11-06T00:00:00Z"});
assert.equal(revoked.effective_trusted_for_promotion,false);
assert.equal(revoked.reason,"provider_trust_revoked");

const lineage=verifyTrustRegistryLineage([v1,v2,v3]);
assert.equal(lineage.valid,true);
assert.equal(lineage.revisions,3);
assert.equal(lineage.head_registry_digest,v3.registry.registry_digest);

const tampered=JSON.parse(JSON.stringify(v2));
tampered.change_reason="quietly changed";
assert.throws(()=>verifyTrustRegistrySnapshot(tampered),/snapshot_digest_mismatch/);

const brokenPrev=JSON.parse(JSON.stringify(v3));
brokenPrev.previous_registry_digest="sha256:"+"f".repeat(64);
brokenPrev.snapshot_digest=require("../scripts/pi_home_provider_trust_lineage.cjs").snapshotDigest(brokenPrev);
assert.throws(
  ()=>verifyTrustRegistryLineage([v1,v2,brokenPrev]),
  /previous_digest_mismatch/
);

assert.throws(
  ()=>evolveTrustRegistrySnapshot(v1,Object.values(v1.registry.entries),{
    changed_at:"2026-09-30T00:00:00Z",
    changed_by:"operator-x",
    change_reason:"backdated",
    change_id:"trust-change-backdated"
  }),
  /time_regression/
);

{
  const duplicateId=JSON.parse(JSON.stringify(v2));
  duplicateId.change_id="trust-change-001";
  duplicateId.snapshot_digest=require("../scripts/pi_home_provider_trust_lineage.cjs").snapshotDigest(duplicateId);
  assert.throws(
    ()=>verifyTrustRegistryLineage([v1,duplicateId]),
    /duplicate_change_id/
  );
}

console.log(JSON.stringify({
  ok:true,
  contract:"provider trust registry changes form a sealed revision lineage with auditable renew/revoke transitions"
}));
