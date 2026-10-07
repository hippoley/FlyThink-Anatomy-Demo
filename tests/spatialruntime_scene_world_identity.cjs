"use strict";

const assert=require("assert");
const {
  sha256Object,
  validateSceneContext,
  sceneWorldIdentity
}=require("../scripts/spatialruntime_world_context.cjs");

function context(overrides={}){
  const base={
    schema:"homeai_spatialruntime_scene_context_v1",
    case_id:"identity-test",
    world_snapshot_sha256:"a".repeat(64),
    validation_receipt_sha256:"b".repeat(64),
    source_fingerprint:"c".repeat(64),
    relation_graph_fingerprint:"d".repeat(64),
    spatialruntime_commit_sha:null,
    exterior_windows:[],
    exterior_window_keys:[],
    ...overrides
  };
  return {...base,context_sha256:sha256Object(base)};
}

{
  const current=context({world_snapshot_revision:12});
  validateSceneContext(current);
  assert.deepEqual(sceneWorldIdentity(current),{
    world_snapshot_revision:12,
    world_snapshot_sha256:"a".repeat(64)
  });
}

{
  const legacy=context();
  assert.doesNotThrow(()=>validateSceneContext(legacy));
  assert.throws(
    ()=>sceneWorldIdentity(legacy),
    /world_revision_required/
  );
}

{
  const bad=context({world_snapshot_revision:-1});
  assert.throws(
    ()=>validateSceneContext(bad),
    /world_revision_invalid/
  );
}

console.log(JSON.stringify({
  ok:true,
  contract:"scene context may remain backward-readable, but canonical execution requires revision + SHA world identity"
}));
