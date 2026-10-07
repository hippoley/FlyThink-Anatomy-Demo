"use strict";

const assert=require("assert");
const {
  RECEIPT_SCHEMA,
  sha256Object,
  validateAuthorizationReceipt
}=require("../scripts/spatialruntime_authorizer.cjs");

function target(){return {area:"客厅",entity:"窗",instance:"default"}}
function patch(value,targetOverride=target()){
  return {
    op:"PATCH_SLOT",
    target:targetOverride,
    slot:"opening",
    value,
    spatialruntime_decision:"commit"
  };
}
function request(){
  return {
    schema:"homeai_spatialruntime_authorization_request_v1",
    case_id:"turn-1",
    source_step:2,
    source_revision:2,
    runtime:{},
    patches:[{op:"PATCH_SLOT",target:target(),slot:"opening",value:5}],
    spatial_context:{},
    max_open_ratio_delta:0.25
  };
}
function receipt(overrides={}){
  const body={
    schema:RECEIPT_SCHEMA,
    canonicalization:"sorted-json-number-normalized-v1",
    allow:true,
    case_id:"turn-1",
    source_step:2,
    source_revision:2,
    requested_patch_count:1,
    authorized_patches:[patch(3)],
    blocked:[],
    rain:"dry",
    exterior_window_keys:[],
    trace_status:"completed",
    trace_hash:"a".repeat(64),
    safety_graph_fingerprint:"b".repeat(64),
    safety_forced_entities:[],
    commit_summary:{ready_to_dispatch:true},
    ...overrides
  };
  body.receipt_sha256=sha256Object(body);
  return body;
}

{
  const out=validateAuthorizationReceipt(receipt(),request(),request().patches);
  assert.equal(out.allow,true);
  assert.equal(out.patches[0].value,3);
  assert.equal(out.integrity.receipt_sha256.length,64);
}

{
  const bad=receipt();
  bad.case_id="other";
  const base={...bad};delete base.receipt_sha256;
  bad.receipt_sha256=sha256Object(base);
  assert.throws(
    ()=>validateAuthorizationReceipt(bad,request(),request().patches),
    /case_id_mismatch/
  );
}

{
  const bad=receipt();
  bad.authorized_patches=[patch(3,{area:"卧室",entity:"窗",instance:"default"})];
  const base={...bad};delete base.receipt_sha256;
  bad.receipt_sha256=sha256Object(base);
  assert.throws(
    ()=>validateAuthorizationReceipt(bad,request(),request().patches),
    /patch_identity_mismatch/
  );
}

{
  const bad=receipt();
  bad.receipt_sha256="0".repeat(64);
  assert.throws(
    ()=>validateAuthorizationReceipt(bad,request(),request().patches),
    /receipt_sha256_mismatch/
  );
}

{
  const bad=receipt({source_revision:9});
  const base={...bad};delete base.receipt_sha256;
  bad.receipt_sha256=sha256Object(base);
  assert.throws(
    ()=>validateAuthorizationReceipt(bad,request(),request().patches),
    /source_revision_mismatch/
  );
}

console.log(JSON.stringify({
  ok:true,
  contract:"SpatialRuntime authorization must match request identity, revision, trace hash and receipt SHA before dispatch"
}));
