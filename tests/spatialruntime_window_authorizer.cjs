"use strict";

const assert=require("assert");
const {MockThingDriver}=require("../scripts/physical_runtime.cjs");
const {runStreamingSequence}=require("../scripts/streaming_slu_e2e.cjs");
const {createSpatialRuntimeAuthorizer,RECEIPT_SCHEMA}=require("../scripts/spatialruntime_authorizer.cjs");

function target(){return {area:"客厅",entity:"窗",instance:"default"}}
function key(){return "客厅::窗::default"}
function runtime(opening=0){
  return {devices:{
    [key()]:{
      key:key(),area:"客厅",entity:"窗",instance:"default",
      status:"mounted",model_id:"CWDS-CA01",
      slots:{opening,power:opening<=1?"OFF":"ON"}
    }
  }};
}
function predictor(value){
  return async()=>({
    decision:"EXECUTE",
    confidence:0.99,
    patches:[{op:"PATCH_SLOT",target:target(),slot:"opening",value}]
  });
}

async function ordinaryOpeningPassesSpatialRuntime(){
  const initial=runtime(0);
  const driver=new MockThingDriver(initial);
  const authorizer=createSpatialRuntimeAuthorizer({timeoutMs:10000});
  const out=await runStreamingSequence([
    {turn_id:"sr-pass",kind:"final",text:"把客厅窗户开到5%"}
  ],{initialRuntime:initial,predictor:predictor(5),driver,physicalAuthorizer:authorizer});

  const row=out.trace[0];
  assert.equal(row.commit_gate.allow,true);
  assert.equal(row.committed,true);
  assert.equal(row.physical_authorization.schema,RECEIPT_SCHEMA);
  assert.equal(row.physical_authorization.allow,true);
  assert.equal(row.authorized_patch_proposal[0].value,5);
  assert.equal(row.physical_authorization.trace_status,"completed");
  assert.equal(row.physical_authorization.trace_hash.length,64);
  assert.equal(row.physical_authorization.receipt_sha256.length,64);
  assert.equal(row.physical_authorization_binding.schema,"homeai_spatialruntime_physical_binding_v1");
  assert.equal(row.physical_authorization_binding.authorization_receipt_sha256,row.physical_authorization.receipt_sha256);
  assert.equal(row.physical_authorization_binding.authorization_trace_hash,row.physical_authorization.trace_hash);
  assert.equal(row.physical_authorization_binding.case_id,"sr-pass");
  assert.equal(row.physical_authorization_binding.source_step,0);
  assert.equal(row.physical_authorization_binding.source_revision,0);
  assert.equal(row.physical_authorization_binding.bindings.length,1);
  assert.equal(row.physical_authorization_binding.bindings[0].status,"applied");
  assert.equal(row.physical_authorization_binding.bindings[0].authorization_patch_sha256,row.physical_authorization_binding.bindings[0].physical_patch_sha256);
  assert.equal(row.physical_authorization_binding.bindings[0].authorized_value,5);
  assert.equal(row.physical_authorization_binding.bindings[0].requested_position_pct,null);
  assert.equal(row.physical_authorization_binding.bindings[0].observed_value,5);
  assert.equal(row.physical_authorization_binding.bindings[0].convergence_error_pct,0);
  assert.equal(row.physical_authorization_binding.bindings[0].observation_sha256.length,64);
  assert.equal(row.physical_authorization_binding.binding_sha256.length,64);
  assert.equal(out.physical_commands,1);
  assert.equal(out.runtime.devices[key()].slots.opening,5);
}

async function reviewedExteriorRainForcesCloseBeforeDriver(){
  const initial=runtime(0);
  const driver=new MockThingDriver(initial);
  const authorizer=createSpatialRuntimeAuthorizer({timeoutMs:10000});
  const out=await runStreamingSequence([
    {
      turn_id:"sr-rain",
      kind:"final",
      text:"把客厅窗户开到5%",
      context_hint:{
        spatialruntime:{
          rain:"wet",
          exterior_window_keys:[key()]
        }
      }
    }
  ],{initialRuntime:initial,predictor:predictor(5),driver,physicalAuthorizer:authorizer});

  const row=out.trace[0];
  assert.equal(row.commit_gate.allow,true);
  assert.equal(row.physical_authorization.allow,true);
  assert.deepEqual(row.physical_authorization.safety_forced_entities,[key()]);
  assert.equal(row.authorized_patch_proposal[0].value,0);
  assert.equal(row.authorized_patch_proposal[0].spatialruntime_decision,"commit_safety_override");
  assert.equal(row.physical_authorization_binding.case_id,"sr-rain");
  assert.equal(row.physical_authorization_binding.bindings[0].authorized_value,0);
  assert.equal(row.physical_authorization_binding.bindings[0].requested_position_pct,null);
  assert.equal(row.physical_authorization_binding.bindings[0].observed_value,0);
  assert.equal(row.physical_authorization_binding.bindings[0].convergence_error_pct,0);
  assert.equal(driver.commands.length,1);
  assert.equal(driver.commands[0].patch.value,0);
  assert.equal(out.runtime.devices[key()].slots.opening,0);
}

async function unsupportedTargetFailsClosed(){
  const initial=runtime(0);
  const driver=new MockThingDriver(initial);
  const authorizer=createSpatialRuntimeAuthorizer({timeoutMs:10000});
  const badPredictor=async()=>({
    decision:"EXECUTE",confidence:0.99,
    patches:[{
      op:"PATCH_SLOT",
      target:{area:"客厅",entity:"空调",instance:"default"},
      slot:"temperature",value:24
    }]
  });
  const out=await runStreamingSequence([
    {turn_id:"sr-unsupported",kind:"final",text:"客厅空调24度"}
  ],{initialRuntime:initial,predictor:badPredictor,driver,physicalAuthorizer:authorizer});

  assert.equal(out.trace[0].committed,false);
  assert.match(out.trace[0].error,/spatialruntime_authorization_blocked/);
  assert.equal(out.physical_commands,0);
}

(async()=>{
  await ordinaryOpeningPassesSpatialRuntime();
  await reviewedExteriorRainForcesCloseBeforeDriver();
  await unsupportedTargetFailsClosed();
  console.log(JSON.stringify({
    ok:true,
    contract:"HomeAI final semantic commit is consumed by SpatialRuntime before WindowPilot-compatible physical dispatch"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
