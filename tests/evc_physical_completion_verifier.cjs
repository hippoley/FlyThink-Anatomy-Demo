"use strict";

const assert=require("assert");
const fs=require("fs");
const path=require("path");
const {spawnSync}=require("child_process");
const {
  evaluateEvcRequest
}=require("../scripts/evc_physical_completion_worker.cjs");

const root=path.join(__dirname,"..");
const verifier=path.join(root,"scripts","evc_physical_completion_verifier.cjs");
const vector=JSON.parse(
  fs.readFileSync(
    path.join(root,"interop","physical-completion","sample-proven.json"),
    "utf8"
  )
);

function request(bundleVector=vector){
  return {
    version:1,
    bundle:JSON.stringify(bundleVector),
    request:{
      agent_name:"home-controller",
      project_key:"/demo/home",
      program:"flythink",
      model:"external-physical-verifier",
      granted_capabilities:["apply_dependent_action"],
      required_precondition:{
        type:"physical_completion",
        criterion_sha256:
          bundleVector.authorized_completion_criterion.criterion_sha256
      }
    },
    now_unix:1791450000
  };
}

{
  const out=evaluateEvcRequest(request());
  assert.equal(out.exitCode,0);
  assert.deepEqual(out.body,{verdict:"allow",kind:"external"});
}

{
  const r=request();
  r.version=2;
  const out=evaluateEvcRequest(r);
  assert.equal(out.exitCode,0);
  assert.equal(out.body.verdict,"deny");
  assert.equal(out.body.kind,"external");
  assert.equal(out.body.code,"unsupported_version");
}

{
  const r=request();
  delete r.request.required_precondition;
  const out=evaluateEvcRequest(r);
  assert.equal(out.body.code,"request_mismatch");
}

{
  const stale=JSON.parse(JSON.stringify(vector));
  stale.physical_receipt.observation.evidence.tick=
    stale.physical_receipt.before_tick;
  const out=evaluateEvcRequest(request(stale));
  assert.equal(out.body.verdict,"deny");
  assert.equal(out.body.kind,"external");
  assert.equal(out.body.code,"request_mismatch");
  assert.equal(
    out.body.detail.physical_completion_result,
    "PHYSICAL_COMPLETION_INDETERMINATE"
  );
}

{
  const invalid=JSON.parse(JSON.stringify(vector));
  invalid.authorized_completion_criterion.criterion_sha256="a".repeat(64);
  const r=request(invalid);
  r.request.required_precondition.criterion_sha256="a".repeat(64);
  const out=evaluateEvcRequest(r);
  assert.equal(out.body.code,"invalid_proof");
}

{
  const r=request();
  r.bundle="{";
  const out=evaluateEvcRequest(r);
  assert.equal(out.body.code,"invalid_bundle");
}

function run(input,env={}){
  return spawnSync(process.execPath,[verifier],{
    input,
    encoding:"utf8",
    env:{...process.env,...env}
  });
}

{
  const child=run(JSON.stringify(request()));
  assert.equal(child.status,0);
  const lines=child.stdout.trim().split("\n");
  assert.equal(lines.length,1);
  assert.deepEqual(JSON.parse(lines[0]),{verdict:"allow",kind:"external"});
}

{
  // Deliberately contaminate the worker's fd1. EVC-02 requires the parent
  // verifier to capture it and keep host-facing stdout as one JSON verdict.
  const child=run(
    JSON.stringify(request()),
    {FLYTHINK_EVC_TEST_STDOUT_NOISE:"1"}
  );
  assert.equal(child.status,0);
  assert.deepEqual(
    JSON.parse(child.stdout.trim()),
    {verdict:"allow",kind:"external"}
  );
  assert.equal(child.stdout.trim().split("\n").length,1);
  assert.match(child.stderr,/evc-worker-stdout-noise/);
}

{
  // A worker crash must never turn an already-produced/partial success into
  // host-visible allow. Parent emits one internal_error deny and exits nonzero.
  const child=run(
    JSON.stringify(request()),
    {FLYTHINK_EVC_TEST_CRASH:"1"}
  );
  assert.notEqual(child.status,0);
  const lines=child.stdout.trim().split("\n");
  assert.equal(lines.length,1);
  const out=JSON.parse(lines[0]);
  assert.equal(out.verdict,"deny");
  assert.equal(out.kind,"external");
  assert.equal(out.code,"internal_error");
}

{
  const child=run("{");
  assert.equal(child.status,0);
  const out=JSON.parse(child.stdout.trim());
  assert.equal(out.verdict,"deny");
  assert.equal(out.code,"malformed_input");
}

{
  const tooLarge=JSON.stringify(request())+" ".repeat(1024*1024);
  const child=run(tooLarge);
  assert.equal(child.status,0);
  const out=JSON.parse(child.stdout.trim());
  assert.equal(out.verdict,"deny");
  assert.equal(out.code,"malformed_input");
}

console.log(JSON.stringify({
  ok:true,
  contract:"EVC-02 external-class physical completion verifier preserves one-object stdout under worker/native fd1 contamination and fails closed on worker failure"
}));
