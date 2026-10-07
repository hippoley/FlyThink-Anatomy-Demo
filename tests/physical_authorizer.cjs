"use strict";

const assert=require("assert");
const {MockThingDriver}=require("../scripts/physical_runtime.cjs");
const {runStreamingSequence}=require("../scripts/streaming_slu_e2e.cjs");

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
function patch(value){
  return {op:"PATCH_SLOT",target:target(),slot:"opening",value};
}

async function authorizerOnlyRunsAfterSemanticCommit(){
  const initial=runtime(0);
  const driver=new MockThingDriver(initial);
  let calls=0;
  const physicalAuthorizer=async({patches,source_step,source_revision})=>{
    calls++;
    assert.equal(source_step,0);
    assert.equal(source_revision,0);
    return {
      allow:true,
      patches:patches.map(p=>({...p,value:3})),
      receipt:{schema:"fake_authorization",allow:true}
    };
  };
  const predictor=async()=>({decision:"EXECUTE",confidence:0.99,patches:[patch(5)]});
  const out=await runStreamingSequence([
    {turn_id:"window-1",kind:"partial",text:"把客厅窗户"},
    {turn_id:"window-1",kind:"stable",text:"把客厅窗户开到5%"},
    {turn_id:"window-1",kind:"final",text:"把客厅窗户开到5%"}
  ],{initialRuntime:initial,predictor,driver,physicalAuthorizer});

  assert.equal(calls,1);
  assert.equal(out.physical_commands,1);
  assert.equal(out.trace[0].physical_authorization,null);
  assert.equal(out.trace[1].physical_authorization,null);
  assert.equal(out.trace[0].physical_revision,0);
  assert.equal(out.trace[1].physical_revision,0);
  assert.equal(out.trace[2].physical_revision,1);
  assert.equal(out.trace[2].commit_gate.allow,true);
  assert.equal(out.trace[2].patch_proposal[0].value,5);
  assert.equal(out.trace[2].authorized_patch_proposal[0].value,3);
  assert.equal(out.trace[2].physical_authorization.allow,true);
  assert.equal(out.runtime.devices[key()].slots.opening,3);
}

async function blockedAuthorizationNeverReachesDriver(){
  const initial=runtime(0);
  const driver=new MockThingDriver(initial);
  const physicalAuthorizer=async()=>{
    const err=new Error("spatialruntime_authorization_blocked:test");
    err.receipt={schema:"fake_authorization",allow:false,reason:"test"};
    throw err;
  };
  const predictor=async()=>({decision:"EXECUTE",confidence:0.99,patches:[patch(5)]});
  const out=await runStreamingSequence([
    {turn_id:"window-2",kind:"final",text:"把客厅窗户开到5%"}
  ],{initialRuntime:initial,predictor,driver,physicalAuthorizer});

  assert.equal(out.trace[0].commit_gate.allow,true);
  assert.equal(out.trace[0].committed,false);
  assert.match(out.trace[0].error,/spatialruntime_authorization_blocked/);
  assert.equal(out.trace[0].physical_authorization.allow,false);
  assert.equal(out.physical_commands,0);
  assert.equal(out.runtime.devices[key()].slots.opening,0);
}

async function bindingFailurePreservesRealityAndQuarantinesTarget(){
  const initial=runtime(0);
  const driver=new MockThingDriver(initial,{
    transform:patchValue=>(
      patchValue.op==="PATCH_SLOT"&&patchValue.slot==="opening"
        ?{value:9}
        :null
    )
  });
  const receipt={
    schema:"homeai_spatialruntime_authorization_receipt_v1",
    allow:true,
    case_id:"window-bind-fail",
    source_step:0,
    source_revision:0,
    receipt_sha256:"r".repeat(64),
    trace_hash:"t".repeat(64)
  };
  const physicalAuthorizer=async({patches})=>({
    allow:true,
    patches:patches.map(p=>({...p,value:5})),
    receipt
  });
  const predictor=async()=>({decision:"EXECUTE",confidence:0.99,patches:[patch(5)]});
  const out=await runStreamingSequence([
    {turn_id:"window-bind-fail",kind:"final",text:"把客厅窗户开到5%"}
  ],{
    initialRuntime:initial,
    predictor,
    driver,
    physicalAuthorizer,
    physicalAuthorizationTolerancePct:1
  });

  const row=out.trace[0];
  assert.equal(out.physical_commands,1);
  assert.equal(out.runtime.devices[key()].slots.opening,9);
  assert.equal(row.committed,false);
  assert.equal(row.physical_revision,0);
  assert.match(row.error,/physical_authorization_binding_failed/);
  assert.equal(
    out.runtime.deviceHealth[key()].status,
    "quarantined"
  );
  assert.match(
    out.runtime.deviceHealth[key()].reason,
    /spatialruntime_observation_outside_authorized_tolerance/
  );

  const second=await runStreamingSequence([
    {turn_id:"window-after-quarantine",kind:"final",text:"把客厅窗户开到20%"}
  ],{
    initialRuntime:out.runtime,
    predictor:async()=>({
      decision:"EXECUTE",
      confidence:0.99,
      patches:[patch(20)]
    }),
    driver:new MockThingDriver(out.runtime),
    physicalAuthorizer
  });
  assert.equal(second.physical_commands,0);
  assert.match(second.trace[0].error,/device_quarantined/);
}

(async()=>{
  await authorizerOnlyRunsAfterSemanticCommit();
  await blockedAuthorizationNeverReachesDriver();
  await bindingFailurePreservesRealityAndQuarantinesTarget();
  console.log(JSON.stringify({
    ok:true,
    contract:"semantic commit -> physical authorizer -> authorized patch -> driver; blocked authorization cannot reach driver"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
