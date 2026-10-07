"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {
  HANDOFF_SCHEMA,
  CONTEXT_SCHEMA,
  sha256Object,
  validateSceneHandoff
}=require("../scripts/spatialruntime_world_context.cjs");
const {
  createSpatialRuntimeAuthorizer
}=require("../scripts/spatialruntime_authorizer.cjs");
const {
  main:buildSceneContext
}=require("../scripts/build_spatialruntime_scene_context.cjs");
const {MockThingDriver}=require("../scripts/physical_runtime.cjs");
const {runStreamingSequence}=require("../scripts/streaming_slu_e2e.cjs");

const SOURCE_COMMIT="1".repeat(40);
const SPATIALRUNTIME_COMMIT=process.env.SPATIALRUNTIME_COMMIT_SHA||"d123ab9a5310cb9ce15d9e82630828a0d32211f4";
const SOURCE_REPO="hippoley/interior-kitchen-original";
const AREA="次卧（二）";
const TARGET={area:AREA,entity:"窗",instance:"default"};
const TARGET_KEY=AREA+"::窗::default";

function buildArtifacts(){
  const sourceFingerprint="c".repeat(64);
  const sourceFiles={"lib/spatial/window-system.ts":"d".repeat(64)};
  const world={
    schema:"spatialruntime_world_snapshot_v1",
    case_id:"handoff-test",
    step:0,
    revision:0,
    entities:{
      "room::bed2":{
        kind:"room",source_id:"bed2",name:AREA,evidence_status:"explicit_source"
      },
      "window::bed2-south-casement":{
        kind:"window",source_id:"bed2-south-casement",name:"次卧联动窗",
        room:"room::bed2",opening_id:"opening::G-bed2",exterior:true,
        evidence_status:"explicit_source"
      },
      "opening::G-bed2":{
        kind:"window_opening",source_id:"G-bed2",evidence_status:"explicit_source"
      }
    },
    relations:[{
      src:"window::bed2-south-casement",
      rel:"belongs_to",
      dst:"room::bed2",
      confidence:1,
      status:"explicit_source",
      evidence:{source:"test"}
    }],
    facts:{
      source_repo:SOURCE_REPO,
      source_kind:"authored_spatial_scene",
      source_fingerprint:sourceFingerprint,
      source_files_sha256:sourceFiles
    }
  };
  const receiptBody={
    schema:"interior_scene_spatialruntime_consumer_v1",
    valid:true,
    case_id:world.case_id,
    spatialruntime_commit_sha:SPATIALRUNTIME_COMMIT,
    world_snapshot_sha256:sha256Object(world),
    source_fingerprint:sourceFingerprint,
    source_fingerprint_verified:true,
    source_file_count:1,
    source_files_sha256:sourceFiles,
    relation_graph_fingerprint:"e".repeat(64),
    entity_count:3,
    relation_count:1,
    room_count:1,
    device_count:0,
    inferred_opening_count:0,
    linked_window_id:"window::bed2-south-casement",
    geographic_facade_known:false
  };
  const receipt={...receiptBody,receipt_sha256:sha256Object(receiptBody)};
  const handoffBody={
    schema:HANDOFF_SCHEMA,
    source_repo:SOURCE_REPO,
    source_commit_sha:SOURCE_COMMIT,
    spatialruntime_commit_sha:SPATIALRUNTIME_COMMIT,
    case_id:world.case_id,
    world_snapshot_sha256:receipt.world_snapshot_sha256,
    validation_receipt_sha256:receipt.receipt_sha256,
    source_fingerprint:receipt.source_fingerprint,
    source_file_count:receipt.source_file_count,
    source_files_sha256:sourceFiles,
    relation_graph_fingerprint:receipt.relation_graph_fingerprint,
    explicit_exterior_windows:[{
      world_entity_id:"window::bed2-south-casement",
      room_entity_id:"room::bed2",
      opening_id:"opening::G-bed2",
      source_id:"bed2-south-casement",
      target_key:TARGET_KEY,
      suggested_homeai_target:TARGET
    }],
    consumer_contracts:[
      "spatialruntime_world_snapshot_v1",
      CONTEXT_SCHEMA
    ]
  };
  const handoff={...handoffBody,handoff_sha256:sha256Object(handoffBody)};
  return {world,receipt,handoff};
}

function writeArtifacts(artifacts){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"homeai-handoff-"));
  const worldPath=path.join(dir,"world.json");
  const receiptPath=path.join(dir,"receipt.json");
  const handoffPath=path.join(dir,"handoff.json");
  fs.writeFileSync(worldPath,JSON.stringify(artifacts.world));
  fs.writeFileSync(receiptPath,JSON.stringify(artifacts.receipt));
  fs.writeFileSync(handoffPath,JSON.stringify(artifacts.handoff));
  return {dir,worldPath,receiptPath,handoffPath};
}

function runtime(opening=0){
  return {devices:{
    [TARGET_KEY]:{
      key:TARGET_KEY,area:AREA,entity:"窗",instance:"default",
      status:"mounted",model_id:"CWDS-CA01",
      slots:{opening,power:opening<=1?"OFF":"ON"}
    }
  }};
}

async function validHandoffDrivesSpatialRuntimeSafety(){
  const artifacts=buildArtifacts();
  const context=validateSceneHandoff(
    artifacts.world,
    artifacts.receipt,
    artifacts.handoff,
    {expectedSourceRepo:SOURCE_REPO,expectedSourceCommit:SOURCE_COMMIT}
  );
  assert.equal(context.handoff_evidence.schema,HANDOFF_SCHEMA);
  assert.equal(context.handoff_evidence.source_commit_sha,SOURCE_COMMIT);
  assert.equal(context.spatialruntime_commit_sha,SPATIALRUNTIME_COMMIT);
  assert.equal(context.handoff_evidence.spatialruntime_commit_sha,SPATIALRUNTIME_COMMIT);
  assert.equal(context.handoff_evidence.handoff_sha256,artifacts.handoff.handoff_sha256);

  const paths=writeArtifacts(artifacts);
  const contextPath=path.join(paths.dir,"context.json");
  const built=buildSceneContext([
    paths.worldPath,
    paths.receiptPath,
    "--handoff",paths.handoffPath,
    "--expected-source-repo",SOURCE_REPO,
    "--expected-source-commit",SOURCE_COMMIT,
    "--out",contextPath
  ]);
  assert.equal(built.handoff_evidence.source_commit_sha,SOURCE_COMMIT);
  const rendered=JSON.parse(fs.readFileSync(contextPath,"utf8"));
  assert.equal(rendered.context_sha256,built.context_sha256);
  assert.equal(rendered.handoff_evidence.handoff_sha256,artifacts.handoff.handoff_sha256);

  const authorizer=createSpatialRuntimeAuthorizer({
    worldSnapshotPath:paths.worldPath,
    worldValidationReceiptPath:paths.receiptPath,
    worldHandoffPath:paths.handoffPath,
    expectedSceneSourceRepo:SOURCE_REPO,
    expectedSceneSourceCommit:SOURCE_COMMIT,
    timeoutMs:10000
  });
  const driver=new MockThingDriver(runtime(0));
  const predictor=async()=>({
    decision:"EXECUTE",
    confidence:0.99,
    patches:[{op:"PATCH_SLOT",target:TARGET,slot:"opening",value:5}]
  });
  const out=await runStreamingSequence([{
    turn_id:"handoff-rain",
    kind:"final",
    text:"把次卧二窗户开到5%",
    context_hint:{spatialruntime:{rain:"wet"}}
  }],{
    initialRuntime:runtime(0),
    predictor,
    driver,
    physicalAuthorizer:authorizer
  });
  const row=out.trace[0];
  assert.equal(row.committed,true);
  assert.equal(row.authorized_patch_proposal[0].value,0);
  assert.equal(row.physical_authorization.scene_evidence.handoff_evidence.source_commit_sha,SOURCE_COMMIT);
  assert.equal(row.physical_authorization.scene_evidence.spatialruntime_commit_sha,SPATIALRUNTIME_COMMIT);
  assert.equal(row.physical_authorization.scene_evidence.handoff_evidence.handoff_sha256,artifacts.handoff.handoff_sha256);
  assert.equal(driver.commands[0].patch.value,0);
}

function tamperedMappingFailsClosed(){
  const artifacts=buildArtifacts();
  artifacts.handoff.explicit_exterior_windows[0].suggested_homeai_target={
    area:"客厅",entity:"窗",instance:"default"
  };
  const base={...artifacts.handoff};delete base.handoff_sha256;
  artifacts.handoff.handoff_sha256=sha256Object(base);
  assert.throws(
    ()=>validateSceneHandoff(artifacts.world,artifacts.receipt,artifacts.handoff),
    /target_mapping_mismatch/
  );
}

function expectedCommitMismatchFailsClosed(){
  const artifacts=buildArtifacts();
  assert.throws(
    ()=>validateSceneHandoff(
      artifacts.world,
      artifacts.receipt,
      artifacts.handoff,
      {expectedSourceCommit:"2".repeat(40)}
    ),
    /source_commit_mismatch/
  );
}


function spatialRuntimeCommitMismatchFailsClosed(){
  const artifacts=buildArtifacts();
  artifacts.handoff.spatialruntime_commit_sha="f".repeat(40);
  const base={...artifacts.handoff};delete base.handoff_sha256;
  artifacts.handoff.handoff_sha256=sha256Object(base);
  assert.throws(
    ()=>validateSceneHandoff(artifacts.world,artifacts.receipt,artifacts.handoff),
    /runtime_commit_mismatch/
  );
}

(async()=>{
  await validHandoffDrivesSpatialRuntimeSafety();
  tamperedMappingFailsClosed();
  expectedCommitMismatchFailsClosed();
  spatialRuntimeCommitMismatchFailsClosed();
  console.log(JSON.stringify({
    ok:true,
    contract:"verified scene handoff -> HomeAI scene context -> SpatialRuntime authorization -> physical dispatch"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
