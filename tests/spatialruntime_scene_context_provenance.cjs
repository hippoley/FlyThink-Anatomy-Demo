"use strict";

const assert=require("assert");
const crypto=require("crypto");
const fs=require("fs");
const {
  loadPinnedSceneContext
}=require("../scripts/spatialruntime_world_context.cjs");

function canonical(v){
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==="object"){
    const out={};
    for(const k of Object.keys(v).sort())out[k]=canonical(v[k]);
    return out;
  }
  return v;
}
function sha256Object(v){
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
}
function isSha(v){return /^[0-9a-f]{64}$/.test(String(v||""))}

const contextPath=process.argv[2];
const provenancePath=process.argv[3];
if(!contextPath||!provenancePath){
  throw new Error("usage: node tests/spatialruntime_scene_context_provenance.cjs CONTEXT PROVENANCE");
}

const context=loadPinnedSceneContext(contextPath);
const provenance=JSON.parse(fs.readFileSync(provenancePath,"utf8"));

assert.equal(provenance.schema,"homeai_scene_context_fixture_provenance_v1");
assert.equal(provenance.source_repo,"hippoley/interior-kitchen-original");
assert.equal(provenance.source_pr,3);
assert.ok(/^[0-9a-f]{40}$/.test(provenance.source_pr_head_sha));
assert.ok(/^[0-9a-f]{40}$/.test(provenance.source_merge_commit_sha));
assert.ok(Number.isInteger(provenance.source_workflow_run_id));
assert.ok(Number.isInteger(provenance.source_artifact_id));
assert.match(provenance.source_artifact_digest,/^sha256:[0-9a-f]{64}$/);
assert.equal(provenance.scene_context_sha256,context.context_sha256);
assert.equal(provenance.world_snapshot_sha256,context.world_snapshot_sha256);
assert.equal(provenance.validation_receipt_sha256,context.validation_receipt_sha256);
assert.equal(provenance.source_fingerprint,context.source_fingerprint);
assert.ok(isSha(provenance.provenance_sha256));

const base=JSON.parse(JSON.stringify(provenance));
delete base.provenance_sha256;
assert.equal(sha256Object(base),provenance.provenance_sha256);

{
  const bad=JSON.parse(JSON.stringify(provenance));
  bad.scene_context_sha256="0".repeat(64);
  const badBase=JSON.parse(JSON.stringify(bad));
  delete badBase.provenance_sha256;
  bad.provenance_sha256=sha256Object(badBase);
  assert.notEqual(bad.scene_context_sha256,context.context_sha256);
}

console.log(JSON.stringify({
  ok:true,
  source_repo:provenance.source_repo,
  source_merge_commit_sha:provenance.source_merge_commit_sha,
  source_workflow_run_id:provenance.source_workflow_run_id,
  source_artifact_id:provenance.source_artifact_id,
  source_artifact_digest:provenance.source_artifact_digest,
  scene_context_sha256:context.context_sha256,
  contract:"pinned private-scene consumer context retains source workflow provenance without cross-repo runtime credentials"
}));
