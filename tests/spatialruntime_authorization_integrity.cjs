"use strict";

const assert=require("assert");
const {
  RECEIPT_SCHEMA,
  sha256Object,
  runtimeRegistryDigest,
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
    runtime:{devices:{
      "客厅::窗::default":{
        key:"客厅::窗::default",
        area:"客厅",
        entity:"窗",
        instance:"default",
        model_id:"CWDS-CA01",
        slots:{opening:0}
      }
    }},
    patches:[{op:"PATCH_SLOT",target:target(),slot:"opening",value:5}],
    spatial_context:{},
    max_open_ratio_delta:0.25,
    get registry_digest(){return runtimeRegistryDigest(this.runtime)}
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
    patch_digest:sha256Object([patch(3)]),
    registry_digest:request().registry_digest,
    authorization_id:"c".repeat(64),
    single_use:true,
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
  // An attacker may also recompute the patch digest and outer receipt hash.
  // The logical patch identity gate must still reject the redirected target.
  bad.patch_digest=sha256Object(bad.authorized_patches);
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
  const bad=receipt({patch_digest:"0".repeat(64)});
  const base={...bad};delete base.receipt_sha256;
  bad.receipt_sha256=sha256Object(base);
  assert.throws(
    ()=>validateAuthorizationReceipt(bad,request(),request().patches),
    /patch_digest_mismatch/
  );
}

{
  const bad=receipt({registry_digest:"0".repeat(64)});
  const base={...bad};delete base.receipt_sha256;
  bad.receipt_sha256=sha256Object(base);
  assert.throws(
    ()=>validateAuthorizationReceipt(bad,request(),request().patches),
    /registry_digest_mismatch/
  );
}

{
  const bad=receipt({single_use:false});
  const base={...bad};delete base.receipt_sha256;
  bad.receipt_sha256=sha256Object(base);
  assert.throws(
    ()=>validateAuthorizationReceipt(bad,request(),request().patches),
    /single_use_required/
  );
}

// source revision remains bound independently of the new provenance fields.
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
  contract:"SpatialRuntime authorization must bind request identity, revision, exact patch digest, registry digest, single-use intent, trace hash and receipt SHA before dispatch"
}));
