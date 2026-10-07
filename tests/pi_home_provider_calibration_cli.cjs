"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawnSync}=require("child_process");

const root=fs.mkdtempSync(path.join(os.tmpdir(),"pi-home-calibration-cli-"));
const report=path.join(root,"report.json");
const runner=path.join(__dirname,"..","scripts","run_pi_home_provider_calibration.cjs");
const fixture=path.join(__dirname,"..","benchmarks","pi_home_provider_calibration_screening_fixture.json");

const ok=spawnSync(process.execPath,[
  runner,
  "--dataset",fixture,
  "--out",report
],{encoding:"utf8"});
assert.equal(ok.status,0,ok.stdout+"\n"+ok.stderr);
const parsed=JSON.parse(fs.readFileSync(report,"utf8"));
assert.equal(parsed.metrics.top1_accuracy,1);
assert.equal(parsed.metrics.pairwise_accuracy,1);
assert.equal(parsed.eligible_for_registry,false);
assert.ok(parsed.failures.includes("measured_non_fixture_source_required"));
assert.match(parsed.report_digest,/^sha256:[0-9a-f]{64}$/);

const required=spawnSync(process.execPath,[
  runner,
  "--dataset",fixture,
  "--out",path.join(root,"required.json"),
  "--require-eligible"
],{encoding:"utf8"});
assert.equal(required.status,2);

const trustAttempt=spawnSync(process.execPath,[
  runner,
  "--dataset",fixture,
  "--out",path.join(root,"trust-report.json"),
  "--calibration-ref","calibration://synthetic/forbidden",
  "--approved-by","test-reviewer",
  "--trust-entry-out",path.join(root,"trust-entry.json")
],{encoding:"utf8"});
assert.notEqual(trustAttempt.status,0);
assert.match(trustAttempt.stderr,/not_eligible/);
assert.equal(fs.existsSync(path.join(root,"trust-entry.json")),false);

console.log(JSON.stringify({
  ok:true,
  contract:"synthetic calibration may score perfectly but cannot emit provider trust"
}));


const measuredFixture=path.join(root,"measured.json");
const measuredRows=[];
for(let i=0;i<12;i++){
  measuredRows.push({
    case_id:"measured-"+String(i+1),
    candidates:[
      {label:"candidate-1",predicted:.1,observed:.1},
      {label:"candidate-2",predicted:.5,observed:.5},
      {label:"candidate-3",predicted:.9,observed:.9}
    ]
  });
}
fs.writeFileSync(measuredFixture,JSON.stringify({
  schema_version:"pi-home-provider-calibration-dataset-v1",
  provider_id:"rain-engineering-cli",
  dimension:"rain_ingress",
  scope_id:"rain-cli-v1",
  source_kind:"measured",
  fixture_only:false,
  direction:"min",
  measurement_provenance:{
    dataset_id:"rain-cli-measured-v1",
    collected_by:"engineering-lab"
  },
  rows:measuredRows
},null,2));

const timeBoundedOut=path.join(root,"time-bounded-trust.json");
const timeBoundedTrust=spawnSync(process.execPath,[
  runner,
  "--dataset",measuredFixture,
  "--out",path.join(root,"time-bounded-report.json"),
  "--calibration-ref","calibration://rain/cli-v1",
  "--approved-by","engineering-review-board",
  "--trust-entry-out",timeBoundedOut,
  "--not-before","2026-10-01T00:00:00Z",
  "--expires-at","2026-11-01T00:00:00Z",
  "--reviewed-at","2026-10-01T00:00:00Z",
  "--review-due-at","2026-10-20T00:00:00Z"
],{encoding:"utf8"});
assert.equal(timeBoundedTrust.status,0,timeBoundedTrust.stdout+"\n"+timeBoundedTrust.stderr);
const timedPayload=JSON.parse(fs.readFileSync(timeBoundedOut,"utf8"));
assert.equal(timedPayload.registry_entry.not_before,"2026-10-01T00:00:00.000Z");
assert.equal(timedPayload.registry_entry.expires_at,"2026-11-01T00:00:00.000Z");
assert.equal(timedPayload.registry_entry.reviewed_at,"2026-10-01T00:00:00.000Z");
assert.equal(timedPayload.registry_entry.review_due_at,"2026-10-20T00:00:00.000Z");

const partialLifecycle=spawnSync(process.execPath,[
  runner,
  "--dataset",measuredFixture,
  "--out",path.join(root,"partial-report.json"),
  "--calibration-ref","calibration://rain/cli-v1",
  "--approved-by","engineering-review-board",
  "--trust-entry-out",path.join(root,"partial-trust.json"),
  "--not-before","2026-10-01T00:00:00Z"
],{encoding:"utf8"});
assert.notEqual(partialLifecycle.status,0);
assert.match(partialLifecycle.stderr,/time-bounded trust requires/);


const invalidWindowOut=path.join(root,"invalid-window-trust.json");
const invalidWindow=spawnSync(process.execPath,[
  runner,
  "--dataset",measuredFixture,
  "--out",path.join(root,"invalid-window-report.json"),
  "--calibration-ref","calibration://rain/invalid-window",
  "--approved-by","engineering-review-board",
  "--trust-entry-out",invalidWindowOut,
  "--not-before","2026-11-01T00:00:00Z",
  "--expires-at","2026-10-01T00:00:00Z",
  "--reviewed-at","2026-10-01T00:00:00Z",
  "--review-due-at","2026-10-20T00:00:00Z"
],{encoding:"utf8"});
assert.notEqual(invalidWindow.status,0);
assert.match(invalidWindow.stderr,/expiry_must_follow/);
assert.equal(fs.existsSync(invalidWindowOut),false);
