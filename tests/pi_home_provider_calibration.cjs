"use strict";

const assert=require("assert");
const {
  evaluateProviderCalibration,
  verifyCalibrationReport,
  buildTrustRegistryEntryFromCalibration,
  buildTrustAttestationFromCalibration
}=require("../scripts/pi_home_provider_calibration.cjs");
const {
  buildProviderTrustRegistry,
  resolveProviderTrust
}=require("../scripts/pi_home_provider_trust.cjs");

function measuredDataset({source_kind="measured",fixture_only=false,wrong=false}={}){
  const rows=[];
  for(let i=0;i<12;i++){
    const flip=wrong&&i<4;
    rows.push({
      case_id:"case-"+String(i+1),
      candidates:[
        {label:"candidate-1",predicted:flip?0.1:0.9,observed:0.9},
        {label:"candidate-2",predicted:flip?0.9:0.2,observed:0.2},
        {label:"candidate-3",predicted:0.5,observed:0.5}
      ]
    });
  }
  return {
    schema_version:"pi-home-provider-calibration-dataset-v1",
    provider_id:"rain-engineering-v1",
    dimension:"rain_ingress",
    scope_id:"home-rain-v1",
    source_kind,
    fixture_only,
    direction:"min",
    measurement_provenance:{
      dataset_id:"rain-lab-2026-10",
      collected_by:"engineering-lab"
    },
    rows
  };
}

const good=evaluateProviderCalibration(measuredDataset(),{
  min_cases:10,
  min_pairwise_comparisons:20,
  min_pairwise_accuracy:.9,
  min_top1_accuracy:.9
});
assert.equal(good.eligible_for_registry,true);
assert.equal(good.failures.length,0);
assert.equal(good.metrics.cases,12);
assert.equal(good.metrics.top1_accuracy,1);
assert.equal(good.metrics.pairwise_accuracy,1);
assert.match(good.report_digest,/^sha256:[0-9a-f]{64}$/);
assert.equal(verifyCalibrationReport(good).valid,true);

const tampered=JSON.parse(JSON.stringify(good));
tampered.metrics.top1_accuracy=.123;
assert.throws(
  ()=>verifyCalibrationReport(tampered),
  /digest_mismatch/
);
assert.throws(
  ()=>buildTrustRegistryEntryFromCalibration(tampered,{
    calibration_ref:"calibration://tampered",
    approved_by:"engineering-review-board"
  }),
  /digest_mismatch/
);

const calibrationRef="calibration://rain/home-rain-v1";
const entry=buildTrustRegistryEntryFromCalibration(good,{
  calibration_ref:calibrationRef,
  approved_by:"engineering-review-board"
});
const attestation=buildTrustAttestationFromCalibration(good,{
  calibration_ref:calibrationRef
});
const registry=buildProviderTrustRegistry([entry]);
const resolution=resolveProviderTrust({
  id:"rain-engineering-v1",
  kind:"engineering-model",
  covered_dimensions:["rain_ingress"],
  evidence_level:"engineering-validated",
  trusted_for_promotion:true,
  trust_attestation:attestation
},registry);
assert.equal(resolution.effective_trusted_for_promotion,true);
assert.equal(resolution.reason,"registry_attestation_match");

const synthetic=evaluateProviderCalibration(measuredDataset({
  source_kind:"synthetic",
  fixture_only:true
}),{
  min_cases:10,min_pairwise_comparisons:20,min_pairwise_accuracy:.9,min_top1_accuracy:.9
});
assert.equal(synthetic.eligible_for_registry,false);
assert.ok(synthetic.failures.includes("measured_non_fixture_source_required"));
assert.throws(
  ()=>buildTrustRegistryEntryFromCalibration(synthetic,{
    calibration_ref:"calibration://synthetic",
    approved_by:"nobody"
  }),
  /not_eligible/
);

const weak=evaluateProviderCalibration(measuredDataset({wrong:true}),{
  min_cases:10,
  min_pairwise_comparisons:20,
  min_pairwise_accuracy:.9,
  min_top1_accuracy:.9
});
assert.equal(weak.eligible_for_registry,false);
assert.ok(
  weak.failures.includes("pairwise_accuracy_below_threshold") ||
  weak.failures.includes("top1_accuracy_below_threshold")
);

const missingProvenance=measuredDataset();
delete missingProvenance.measurement_provenance;
const noProv=evaluateProviderCalibration(missingProvenance,{
  min_cases:10,min_pairwise_comparisons:20,min_pairwise_accuracy:.9,min_top1_accuracy:.9
});
assert.equal(noProv.eligible_for_registry,false);
assert.ok(noProv.failures.includes("measurement_provenance_required"));

console.log(JSON.stringify({
  ok:true,
  contract:"only independent measured calibration that passes ranking thresholds can produce an approved trust-registry entry"
}));
