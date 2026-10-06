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
  assert.equal(out.trace[0].patch_proposal[0].value,24);
  assert.equal(out.trace[0].feedback[0].slots.temperature,25);
  assert.equal(out.runtime.devices[key("主卧")].slots.temperature,25);
  assert.ok(out.trace[0].reconcile.changed_device_paths.some(x=>x.includes("temperature")));
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


async function staleRevisionMustNotReachPhysicalDriver(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const predictor=async()=>({
    decision:"EXECUTE",confidence:0.99,patches:[patch("客厅",26)]
  });
  const out=await runStreamingSequence([
    // Simulate a proposal created from revision 0 arriving after the runtime
    // has already advanced. The gate must reject it before any driver command.
    {turn_id:"t4",kind:"final",text:"客厅空调调到26度",base_revision:-1,retry_base_revision:-1}
  ],{initialRuntime:initial,predictor,driver});

  assert.equal(out.trace[0].commit_gate.allow,false);
  assert.equal(out.trace[0].commit_gate.reason,"stale_base_revision");
  assert.equal(out.physical_commands,0);
  assert.equal(out.runtime.devices[key("客厅")].slots.temperature,22);
}


async function staleRevisionMayRecoverExactlyOnce(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const attempts=[];
  const predictor=async({attempt})=>{
    attempts.push(attempt);
    return {decision:"EXECUTE",confidence:0.99,patches:[patch("客厅",26)]};
  };
  const out=await runStreamingSequence([
    {turn_id:"t5",kind:"final",text:"客厅空调调到26度",base_revision:-1}
  ],{initialRuntime:initial,predictor,driver});

  assert.deepEqual(attempts,[0,1]);
  assert.equal(out.trace[0].recovery.attempted,true);
  assert.equal(out.trace[0].recovery.initial_gate.reason,"stale_base_revision");
  assert.equal(out.trace[0].recovery.retry_gate.allow,true);
  assert.equal(out.physical_commands,1);
  assert.equal(out.runtime.devices[key("客厅")].slots.temperature,26);
}

async function repeatedStaleMustStopAfterOneRecovery(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const attempts=[];
  const predictor=async({attempt})=>{
    attempts.push(attempt);
    return {decision:"EXECUTE",confidence:0.99,patches:[patch("客厅",26)]};
  };
  const out=await runStreamingSequence([
    {
      turn_id:"t6",kind:"final",text:"客厅空调调到26度",
      base_revision:-1,retry_base_revision:-1
    }
  ],{initialRuntime:initial,predictor,driver});

  assert.deepEqual(attempts,[0,1]);
  assert.equal(out.trace[0].commit_gate.allow,false);
  assert.equal(out.trace[0].commit_gate.reason,"stale_base_revision");
  assert.equal(out.physical_commands,0);
  assert.equal(out.runtime.devices[key("客厅")].slots.temperature,22);
}


async function relativeIntentMustRematerializeAfterStale(){
  const initial=runtime();
  // The current authoritative world is already 25C. The stale proposal was
  // produced from an older revision; recovery must preserve +1 intent rather
  // than replaying an old absolute temperature.
  initial.devices[key("客厅")].slots.temperature=25;
  const driver=new MockThingDriver(initial);
  const attempts=[];
  const predictor=async({attempt})=>{
    attempts.push(attempt);
    return {
      decision:"EXECUTE",
      confidence:0.99,
      patches:[{
        op:"PATCH_RELATIVE",
        target:target("客厅"),
        slot:"temperature",
        delta:1
      }]
    };
  };
  const out=await runStreamingSequence([
    {turn_id:"t7",kind:"final",text:"客厅空调再调高一点",base_revision:-1}
  ],{initialRuntime:initial,predictor,driver});

  assert.deepEqual(attempts,[0,1]);
  assert.equal(out.trace[0].recovery.initial_gate.reason,"stale_base_revision");
  assert.equal(out.trace[0].recovery.retry_gate.allow,true);
  assert.equal(out.trace[0].patch_proposal[0].op,"PATCH_RELATIVE");
  assert.equal(out.trace[0].patch_proposal[0].delta,1);
  assert.equal(out.trace[0].thing_model[0].physical_patch.op,"PATCH_SLOT");
  assert.equal(out.trace[0].thing_model[0].physical_patch.value,26);
  assert.equal(out.runtime.devices[key("客厅")].slots.temperature,26);
  assert.equal(out.physical_commands,1);
}

(async()=>{
  await correctionMustNotExecuteStablePrefix();
  await feedbackMustOwnReconciledTruth();
  await finalClarifyMustNotExecute();
  await staleRevisionMustNotReachPhysicalDriver();
  await staleRevisionMayRecoverExactlyOnce();
  await repeatedStaleMustStopAfterOneRecovery();
  await relativeIntentMustRematerializeAfterStale();
  console.log(JSON.stringify({
    ok:true,
    contract:"streaming ASR -> semantic -> target -> patch -> commit -> thing model -> feedback -> reconcile"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
