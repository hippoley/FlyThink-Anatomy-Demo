"use strict";

const assert=require("assert");
const {
  createSpatialRuntimeAuthorizer
}=require("../scripts/spatialruntime_authorizer.cjs");
const {MockThingDriver}=require("../scripts/physical_runtime.cjs");
const {runStreamingSequence}=require("../scripts/streaming_slu_e2e.cjs");

const sceneContextPath=process.argv[2];
if(!sceneContextPath)throw new Error("usage: node tests/spatialruntime_scene_authorizer.cjs SCENE_CONTEXT");

function key(area){return [area,"窗","default"].join("::")}
function target(area){return {area,entity:"窗",instance:"default"}}
function runtime(area,opening=0){
  return {devices:{
    [key(area)]:{
      key:key(area),
      area,
      entity:"窗",
      instance:"default",
      status:"mounted",
      model_id:"CWDS-CA01",
      slots:{opening,power:opening<=1?"OFF":"ON"}
    }
  }};
}
function predictor(area,value){
  return async()=>({
    decision:"EXECUTE",
    confidence:0.99,
    patches:[{op:"PATCH_SLOT",target:target(area),slot:"opening",value}]
  });
}

async function reviewedSceneWindowFeedsRainSafety(){
  const area="次卧（二）";
  const initial=runtime(area,0);
  const driver=new MockThingDriver(initial);
  const authorizer=createSpatialRuntimeAuthorizer({
    sceneContextPath,
    timeoutMs:10000
  });
  const out=await runStreamingSequence([
    {
      turn_id:"scene-rain",
      kind:"final",
      text:"把次卧二的窗户开到5%",
      context_hint:{spatialruntime:{rain:"wet"}}
    }
  ],{
    initialRuntime:initial,
    predictor:predictor(area,5),
    driver,
    physicalAuthorizer:authorizer
  });

  const row=out.trace[0];
  assert.equal(row.commit_gate.allow,true);
  assert.equal(row.committed,true);
  assert.equal(row.patch_proposal[0].value,5);
  assert.equal(row.authorized_patch_proposal[0].value,0);
  assert.equal(row.authorized_patch_proposal[0].spatialruntime_decision,"commit_safety_override");
  assert.deepEqual(row.physical_authorization.exterior_window_keys,[key(area)]);
  assert.equal(row.physical_authorization.scene_evidence.schema,"homeai_spatialruntime_scene_context_v1");
  assert.match(row.physical_authorization.scene_evidence.source_commit_sha,/^[0-9a-f]{40}$/);
  assert.equal(row.physical_authorization.scene_evidence.world_snapshot_sha256.length,64);
  assert.equal(row.physical_authorization.scene_evidence.validation_receipt_sha256.length,64);
  assert.equal(row.physical_authorization.scene_evidence.context_sha256.length,64);
  if(process.env.SPATIALRUNTIME_COMMIT_SHA&&row.physical_authorization.scene_evidence.spatialruntime_commit_sha){
    assert.equal(
      row.physical_authorization.scene_evidence.spatialruntime_commit_sha,
      process.env.SPATIALRUNTIME_COMMIT_SHA
    );
  }
  assert.deepEqual(row.physical_authorization.safety_forced_entities,[key(area)]);
  assert.equal(driver.commands.length,1);
  assert.equal(driver.commands[0].patch.value,0);
  assert.equal(out.runtime.devices[key(area)].slots.opening,0);
}

async function unreviewedSceneTargetFailsBeforeDriver(){
  const area="客厅";
  const initial=runtime(area,0);
  const driver=new MockThingDriver(initial);
  const authorizer=createSpatialRuntimeAuthorizer({
    sceneContextPath,
    timeoutMs:10000
  });
  const out=await runStreamingSequence([
    {
      turn_id:"scene-unreviewed",
      kind:"final",
      text:"把客厅窗户开到5%",
      context_hint:{spatialruntime:{rain:"wet"}}
    }
  ],{
    initialRuntime:initial,
    predictor:predictor(area,5),
    driver,
    physicalAuthorizer:authorizer
  });

  assert.equal(out.trace[0].commit_gate.allow,true);
  assert.equal(out.trace[0].committed,false);
  assert.match(out.trace[0].error,/spatialruntime_scene_target_not_reviewed/);
  assert.equal(out.physical_commands,0);
  assert.equal(driver.commands.length,0);
}

async function manualExteriorHintCannotEscapeSceneReview(){
  const area="次卧（二）";
  const initial=runtime(area,0);
  const driver=new MockThingDriver(initial);
  const authorizer=createSpatialRuntimeAuthorizer({
    sceneContextPath,
    timeoutMs:10000
  });
  const out=await runStreamingSequence([
    {
      turn_id:"scene-hint-injection",
      kind:"final",
      text:"把次卧二的窗户开到5%",
      context_hint:{
        spatialruntime:{
          rain:"wet",
          exterior_window_keys:["客厅::窗::default"]
        }
      }
    }
  ],{
    initialRuntime:initial,
    predictor:predictor(area,5),
    driver,
    physicalAuthorizer:authorizer
  });

  assert.equal(out.trace[0].committed,false);
  assert.match(out.trace[0].error,/spatialruntime_scene_hint_not_reviewed/);
  assert.equal(driver.commands.length,0);
}

(async()=>{
  await reviewedSceneWindowFeedsRainSafety();
  await unreviewedSceneTargetFailsBeforeDriver();
  await manualExteriorHintCannotEscapeSceneReview();
  console.log(JSON.stringify({
    ok:true,
    contract:"validated authored WorldSnapshot -> HomeAI scene context -> SpatialRuntime safety -> physical dispatch"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
