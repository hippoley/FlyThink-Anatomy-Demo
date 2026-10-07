"use strict";

const assert=require("assert");
const {
  buildProviderTrustRegistry,
  resolveProviderTrust,
  applyResolvedTrust
}=require("../scripts/pi_home_provider_trust.cjs");
const {
  evaluateCalibrationDataset,
  registryEntryFromCertificate
}=require("../scripts/pi_home_provider_calibration.cjs");

function measuredSamples(dimension,count,offset=.05){
  return Array.from({length:count},(_,i)=>({
    id:dimension+"-"+String(i+1),
    measurement_ref:"measurement://"+dimension+"/"+String(i+1),
    dimension,
    predicted:i+offset,
    observed:i
  }));
}

const cert=evaluateCalibrationDataset({
  schema_version:"pi-home-provider-calibration-dataset-v1",
  provider_id:"contam-engineering",
  scope_id:"home-profile-v7",
  evidence_level:"engineering-validated",
  source_kind:"measured",
  samples:[
    ...measuredSamples("co2",20,.05),
    ...measuredSamples("airflow",20,.01)
  ]
},{
  thresholds:{
    co2:{min_samples:20,max_mae:.1,max_rmse:.1,max_abs_error:.1},
    airflow:{min_samples:20,max_mae:.02,max_rmse:.02,max_abs_error:.02}
  }
});
assert.equal(cert.passed,true);

const entry=registryEntryFromCertificate(cert,{approved_by:"engineering-review-board"});
const registry=buildProviderTrustRegistry([entry],{certificates:[cert]});
assert.equal(registry.entries["contam-engineering"].certificate_verified,true);

const provider={
  id:"contam-engineering",
  covered_dimensions:["co2"],
  evidence_level:"engineering-validated",
  trusted_for_promotion:true,
  trust_attestation:{
    scope_id:"home-profile-v7",
    calibration_ref:cert.calibration_ref,
    calibration_digest:cert.calibration_digest
  }
};

const ok=resolveProviderTrust(provider,registry);
assert.equal(ok.claimed_trusted_for_promotion,true);
assert.equal(ok.effective_trusted_for_promotion,true);
assert.equal(ok.reason,"registry_attestation_match");

const handWritten=buildProviderTrustRegistry([entry]);
const handwrittenTrust=resolveProviderTrust(provider,handWritten);
assert.equal(handwrittenTrust.effective_trusted_for_promotion,false);
assert.equal(handwrittenTrust.reason,"provider_calibration_certificate_unverified");
assert.equal(handwrittenTrust.certificate_reason,"calibration_certificate_missing");

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

const revokedEntry={...entry,status:"revoked"};
const revoked=buildProviderTrustRegistry([revokedEntry],{certificates:[cert]});
const revokedResult=resolveProviderTrust(provider,revoked);
assert.equal(revokedResult.effective_trusted_for_promotion,false);
assert.equal(revokedResult.reason,"provider_trust_revoked");

const applied=applyResolvedTrust(provider,registry);
assert.equal(applied.claimed_trusted_for_promotion,true);
assert.equal(applied.trusted_for_promotion,true);

console.log(JSON.stringify({
  ok:true,
  contract:"provider trust becomes effective only from an active registry entry backed by a verified measured-data calibration certificate"
}));
