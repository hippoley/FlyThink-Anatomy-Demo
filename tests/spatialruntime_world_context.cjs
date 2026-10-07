"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {
  CONTEXT_SCHEMA,
  sha256Object,
  loadSceneContext,
  validateSceneArtifacts
}=require("../scripts/spatialruntime_world_context.cjs");

const worldPath=process.argv[2];
const receiptPath=process.argv[3];
if(!worldPath||!receiptPath)throw new Error("usage: node tests/spatialruntime_world_context.cjs WORLD RECEIPT");

const world=JSON.parse(fs.readFileSync(worldPath,"utf8"));
const receipt=JSON.parse(fs.readFileSync(receiptPath,"utf8"));
const context=loadSceneContext(worldPath,receiptPath);

assert.equal(context.schema,CONTEXT_SCHEMA);
assert.equal(context.case_id,"interior-kitchen-original");
assert.equal(context.world_snapshot_sha256,receipt.world_snapshot_sha256);
assert.equal(context.validation_receipt_sha256,receipt.receipt_sha256);
assert.equal(context.source_commit_sha,receipt.source_commit_sha);
assert.equal(context.source_commit_sha,world.facts.source_commit_sha);
assert.equal(context.source_fingerprint,receipt.source_fingerprint);
assert.equal(context.spatialruntime_commit_sha,receipt.spatialruntime_commit_sha||null);
assert.equal(context.context_sha256.length,64);
assert.deepEqual(context.exterior_window_keys,["次卧（二）::窗::default"]);
assert.equal(context.exterior_windows.length,1);
assert.equal(context.exterior_windows[0].world_entity_id,"window::bed2-south-casement");
assert.equal(context.exterior_windows[0].room_entity_id,"room::bed2");
assert.equal(context.exterior_windows[0].opening_id,"opening::G-bed2");

{
  const tampered=JSON.parse(JSON.stringify(world));
  tampered.entities["room::bed2"].name="伪造房间名";
  assert.throws(
    ()=>validateSceneArtifacts(tampered,receipt),
    /world_sha256_mismatch/
  );
}

{
  const tampered=JSON.parse(JSON.stringify(receipt));
  tampered.source_fingerprint="0".repeat(64);
  const base={...tampered};delete base.receipt_sha256;
  tampered.receipt_sha256=sha256Object(base);
  assert.throws(
    ()=>validateSceneArtifacts(world,tampered),
    /source_fingerprint_mismatch/
  );
}

{
  const tampered=JSON.parse(JSON.stringify(world));
  const rel=tampered.relations.find(
    x=>x.src==="window::bed2-south-casement"&&x.rel==="belongs_to"
  );
  rel.status="source_inferred";
  const tamperedReceipt=JSON.parse(JSON.stringify(receipt));
  tamperedReceipt.world_snapshot_sha256=sha256Object(tampered);
  const base={...tamperedReceipt};delete base.receipt_sha256;
  tamperedReceipt.receipt_sha256=sha256Object(base);
  assert.throws(
    ()=>validateSceneArtifacts(tampered,tamperedReceipt),
    /window_room_relation_unreviewed/
  );
}

console.log(JSON.stringify({
  ok:true,
  context_sha256:context.context_sha256,
  exterior_window_keys:context.exterior_window_keys,
  contract:"validated WorldSnapshot + validation receipt -> explicit HomeAI exterior-window context"
}));
