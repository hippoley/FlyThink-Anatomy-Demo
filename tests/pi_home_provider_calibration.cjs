"use strict";

const assert=require("assert");
const {
  evaluateCalibrationDataset,
  registryEntryFromCertificate,
  buildCertifiedProviderTrustRegistry
}=require("../scripts/pi_home_provider_calibration.cjs");
const {
  resolveProviderTrust
}=require("../scripts/pi_home_provider_trust.cjs");

function samples(dimension,count,predicted,observedStart=0){
  return Array.from({length:count},(_,i)=>({
    id:dimension+"-"+String(i+1),
    measurement_ref:"measurement://"+dimension+"/"+String(i+1),
    dimension,
    predicted:predicted(i),
    observed:observedStart+i
  }));
}

const measured={
  schema_version:"pi-home-provider-calibration-dataset-v1",
  provider_id:"rain-engineering-v1",
  scope_id:"home-profile-v7",
  evidence_level:"engineering-validated",
  source_kind:"measured",
  samples:samples("rain_ingress",20,i=>i+0.1)
};
const cert=evaluateCalibrationDataset(measured,{
  thresholds:{
    rain_ingress:{
      min_samples:20,
      max_mae:.2,
      max_rmse:.2,
      max_abs_error:.2
    }
  }
});
assert.equal(cert.passed,true);
assert.equal(cert.covered_dimensions[0],"rain_ingress");
assert.ok(cert.calibration_digest.startsWith("sha256:"));
assert.ok(cert.dataset_digest.startsWith("sha256:"));

const entry=registryEntryFromCertificate(cert,{approved_by:"engineering-review-board"});
assert.equal(entry.provider_id,"rain-engineering-v1");
assert.equal(entry.calibration_digest,cert.calibration_digest);
assert.equal(entry.calibration_ref,cert.calibration_ref);

const registry=buildCertifiedProviderTrustRegistry([
  {certificate:cert,approved_by:"engineering-review-board"}
]);
assert.equal(registry.entries["rain-engineering-v1"].certificate_verified,true);
const provider={
  id:"rain-engineering-v1",
  covered_dimensions:["rain_ingress"],
  evidence_level:"engineering-validated",
  trusted_for_promotion:true,
  trust_attestation:{
    scope_id:"home-profile-v7",
    calibration_ref:cert.calibration_ref,
    calibration_digest:cert.calibration_digest
  }
};
const trust=resolveProviderTrust(provider,registry);
assert.equal(trust.effective_trusted_for_promotion,true);

const fixture=evaluateCalibrationDataset({
  ...measured,
  source_kind:"test-fixture"
},{
  thresholds:{
    rain_ingress:{min_samples:20,max_mae:.2,max_rmse:.2,max_abs_error:.2}
  }
});
assert.equal(fixture.source_kind_accepted,false);
assert.equal(fixture.passed,false);
assert.throws(
  ()=>registryEntryFromCertificate(fixture,{approved_by:"engineering-review-board"}),
  /not_passed/
);

const bad=evaluateCalibrationDataset({
  ...measured,
  samples:samples("rain_ingress",20,i=>i+5)
},{
  thresholds:{
    rain_ingress:{min_samples:20,max_mae:.2,max_rmse:.2,max_abs_error:.2}
  }
});
assert.equal(bad.passed,false);

const tooSmall=evaluateCalibrationDataset({
  ...measured,
  samples:samples("rain_ingress",5,i=>i)
},{
  thresholds:{
    rain_ingress:{min_samples:20,max_mae:.2,max_rmse:.2,max_abs_error:.2}
  }
});
assert.equal(tooSmall.passed,false);

assert.throws(
  ()=>evaluateCalibrationDataset({
    ...measured,
    samples:[
      {id:"x",measurement_ref:"measurement://same",dimension:"rain_ingress",predicted:1,observed:1},
      {id:"y",measurement_ref:"measurement://same",dimension:"rain_ingress",predicted:1,observed:1}
    ]
  },{
    thresholds:{rain_ingress:{min_samples:1,max_mae:1,max_rmse:1,max_abs_error:1}}
  }),
  /duplicate_measurement_ref/
);

console.log(JSON.stringify({
  ok:true,
  contract:"provider registry entries can be derived only from passing measured-data calibration certificates plus explicit approval"
}));
