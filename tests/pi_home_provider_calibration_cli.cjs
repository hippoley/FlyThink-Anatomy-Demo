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
