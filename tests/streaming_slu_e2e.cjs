"use strict";

const assert=require("assert");
const {MockThingDriver}=require("../scripts/physical_runtime.cjs");
const {runStreamingSequence}=require("../scripts/streaming_slu_e2e.cjs");

function target(area){
  return {area,entity:"空调",instance:"default"};
}
function key(area){return area+"::空调::default"}
function runtime(){
  return {
    devices:{
      [key("客厅")]:{
        key:key("客厅"),area:"客厅",entity:"空调",instance:"default",
        status:"mounted",model_id:"AWGD-ZA01",slots:{power:"ON",temperature:22}
      },
      [key("主卧")]:{
        key:key("主卧"),area:"主卧",entity:"空调",instance:"default",
        status:"mounted",model_id:"AWGD-ZA01",slots:{power:"ON",temperature:27}
      }
    }
  };
}
function patch(area,value){
  return {op:"PATCH_SLOT",target:target(area),slot:"temperature",value};
}

async function correctionMustNotExecuteStablePrefix(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const predictor=async({text})=>{
    if(text.includes("主卧"))return {decision:"EXECUTE",confidence:0.99,patches:[patch("主卧",24)]};
    return {decision:"EXECUTE",confidence:0.99,patches:[patch("客厅",26)]};
  };
  const out=await runStreamingSequence([
    {turn_id:"t1",kind:"partial",text:"把客厅空调"},
    {turn_id:"t1",kind:"stable",text:"把客厅空调调到26度"},
    {turn_id:"t1",kind:"final",text:"不对，主卧空调调到24度"}
  ],{initialRuntime:initial,predictor,driver});

  assert.equal(out.trace[0].commit_gate.allow,false);
  assert.equal(out.trace[1].commit_gate.allow,false);
  assert.equal(out.trace[1].commit_gate.deferred,true);
  assert.equal(out.trace[1].physical_command_count_after,0);
  assert.equal(out.trace[2].commit_gate.allow,true);
  assert.equal(out.trace[2].committed,true);
  assert.equal(out.physical_commands,1);
  assert.equal(out.runtime.devices[key("客厅")].slots.temperature,22);
  assert.equal(out.runtime.devices[key("主卧")].slots.temperature,24);
  assert.deepEqual(out.trace[2].target_resolution.targets,[target("主卧")]);
  assert.equal(out.trace[2].thing_model[0].binding.model_id,"AWGD-ZA01");
  assert.equal(out.trace[2].feedback[0].slots.temperature,24);
}

async function feedbackMustOwnReconciledTruth(){
  const initial=runtime();
  const driver=new MockThingDriver(initial,{
    transform:(effective)=>{
      if(effective.slot==="temperature"&&effective.value===24)return {value:25};
      return null;
    }
  });
  const predictor=async()=>({
    decision:"EXECUTE",confidence:0.98,patches:[patch("主卧",24)]
  });
  const out=await runStreamingSequence([
    {turn_id:"t2",kind:"final",text:"主卧空调调到24度"}
  ],{initialRuntime:initial,predictor,driver});

  assert.equal(out.physical_commands,1);
  assert.equal(out.trace[0].committed,true);
  assert.equal(out.trace[0].patch_proposal[0].value,24);
  assert.equal(out.trace[0].feedback[0].slots.temperature,25);
  assert.equal(out.runtime.devices[key("主卧")].slots.temperature,25);
  assert.ok(out.trace[0].reconcile.changed_device_paths.some(x=>x.includes("temperature")));
}

async function rejectedPhysicalReceiptMustNotBecomeCommit(){
  const initial=runtime();
  const driver=new MockThingDriver(initial,{
    reject:()=>true
  });
  const predictor=async()=>({
    decision:"EXECUTE",confidence:0.99,patches:[patch("主卧",24)]
  });
  const out=await runStreamingSequence([
    {turn_id:"t4",kind:"final",text:"主卧空调调到24度"}
  ],{initialRuntime:initial,predictor,driver});

  assert.equal(out.trace[0].commit_gate.allow,true);
  assert.equal(out.trace[0].thing_model[0].status,"rejected");
  assert.equal(out.trace[0].committed,false);
  assert.equal(out.trace[0].error,"physical_receipt_not_applied:rejected");
  assert.equal(out.history[0].outcome,"INVALID");
  assert.equal(out.history[0].committed,false);
  assert.deepEqual(out.history[0].applied_patches,[]);
  assert.equal(out.runtime.devices[key("主卧")].slots.temperature,27);
}

async function quarantinePreflightMustBlockBeforeDriver(){
  const initial=runtime();
  initial.deviceHealth={
    [key("主卧")]:{
      status:"quarantined",
      reason:"safety_stop_not_confirmed",
      source_status:"unsafe",
      command_id:"cmd-unsafe",
      since_turn_id:"t0"
    }
  };

  const blockedDriver=new MockThingDriver(initial);
  const blockedPredictor=async()=>({
    decision:"EXECUTE",
    confidence:0.99,
    patches:[patch("主卧",20)]
  });
  const blocked=await runStreamingSequence([
    {turn_id:"t5",kind:"final",text:"主卧空调调到20度"}
  ],{
    initialRuntime:initial,
    predictor:blockedPredictor,
    driver:blockedDriver
  });

  assert.equal(blocked.physical_commands,0);
  assert.equal(blocked.trace[0].committed,false);
  assert.match(
    blocked.trace[0].error,
    /^semantic_preflight_blocked:device_quarantined:主卧::空调::default$/
  );
  assert.equal(blocked.history[0].outcome,"INVALID");
  assert.deepEqual(blocked.history[0].applied_patches,[]);
  assert.equal(
    blocked.runtime.devices[key("主卧")].slots.temperature,
    27
  );

  const recoveryDriver=new MockThingDriver(initial);
  const recoveryPredictor=async()=>({
    decision:"EXECUTE",
    confidence:0.99,
    patches:[{
      op:"PATCH_SLOT",
      target:target("主卧"),
      slot:"power",
      value:"OFF"
    }]
  });
  const recovery=await runStreamingSequence([
    {turn_id:"t6",kind:"final",text:"把主卧空调关掉"}
  ],{
    initialRuntime:initial,
    predictor:recoveryPredictor,
    driver:recoveryDriver
  });

  assert.equal(recovery.physical_commands,1);
  assert.equal(recovery.trace[0].committed,true);
  assert.equal(
    recovery.runtime.devices[key("主卧")].slots.power,
    "OFF"
  );
  assert.equal(
    recovery.runtime.deviceHealth[key("主卧")].status,
    "quarantined",
    "successful safety reduction must not silently clear quarantine"
  );
}

async function semanticOnlyFinalizationMustNeverCrossPhysicalBoundary(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const predictor=async()=>({
    decision:"EXECUTE",
    confidence:0.99,
    patches:[patch("主卧",24)]
  });
  const out=await runStreamingSequence([
    {turn_id:"t-semantic",kind:"partial",text:"把主卧空调"},
    {turn_id:"t-semantic",kind:"final",text:"把主卧空调调到24度"}
  ],{
    initialRuntime:initial,
    predictor,
    driver,
    semanticOnly:true
  });

  assert.equal(out.trace[0].semantic_ready,false);
  assert.equal(out.trace[1].semantic_ready,true);
  assert.equal(out.trace[1].physical_boundary_crossed,false);
  assert.equal(out.trace[1].committed,false);
  assert.equal(out.physical_commands,0);
  assert.deepEqual(out.runtime.devices,initial.devices);
  assert.deepEqual(out.trace[1].patch_proposal,[patch("主卧",24)]);
  assert.equal(out.history[0].semantic_ready,true);
  assert.equal(out.history[0].physical_boundary_crossed,false);
  assert.deepEqual(out.history[0].applied_patches,[]);
}

async function finalClarifyMustNotExecute(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const predictor=async()=>({decision:"CLARIFY",confidence:0.51,patches:[]});
  const out=await runStreamingSequence([
    {turn_id:"t3",kind:"partial",text:"关"},
    {turn_id:"t3",kind:"final",text:"关掉"}
  ],{initialRuntime:initial,predictor,driver});
  assert.equal(out.physical_commands,0);
  assert.equal(out.trace[1].commit_gate.allow,false);
  assert.deepEqual(out.runtime.devices,initial.devices);
}

(async()=>{
  await correctionMustNotExecuteStablePrefix();
  await feedbackMustOwnReconciledTruth();
  await rejectedPhysicalReceiptMustNotBecomeCommit();
  await quarantinePreflightMustBlockBeforeDriver();
  await finalClarifyMustNotExecute();
  await semanticOnlyFinalizationMustNeverCrossPhysicalBoundary();
  console.log(JSON.stringify({
    ok:true,
    contract:"streaming ASR separates semantic readiness from physical commit; semantic-only finalization makes zero driver calls and preserves runtime"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
