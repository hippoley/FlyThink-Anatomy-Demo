"use strict";

const assert=require("assert");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");
const {runtimeRegistryDigest}=require("../scripts/spatialruntime_authorizer.cjs");
const {
  sha256Object,
  FlyThinkExecutionRuntime
}=require("../scripts/flythink_execution_runtime.cjs");
const {StreamingHomeSession}=require("../scripts/streaming_slu_e2e.cjs");

const W={area:"客厅",entity:"窗",instance:"default"};
const key="客厅::窗::default";
const initial=normalizeRuntime({devices:{
  [key]:{
    key,
    area:"客厅",
    entity:"窗",
    instance:"default",
    model_id:"CWDS-CA01",
    slots:{opening:0,power:"OFF"}
  }
}});

function ledger(){
  const seen=new Set();
  return {
    add(id){
      if(seen.has(id))return false;
      seen.add(id);
      return true;
    },
    has(id){return seen.has(id)}
  };
}

async function authorizer({runtime,patches,event,source_step,source_revision}){
  const authorized=patches.map(x=>JSON.parse(JSON.stringify(x)));
  const patchDigest=sha256Object(authorized);
  const registryDigest=runtimeRegistryDigest(runtime);
  const receiptBase={
    schema:"test-authorization-v1",
    allow:true,
    authorization_id:sha256Object({
      case_id:String(event&&event.turn_id||""),
      patch_digest:patchDigest,
      registry_digest:registryDigest
    }),
    patch_digest:patchDigest,
    registry_digest:registryDigest,
    single_use:true,
    case_id:String(event&&event.turn_id||""),
    source_step:Number(source_step||0),
    source_revision:Number(source_revision||0),
    authorized_patches:authorized
  };
  return {
    allow:true,
    patches:authorized,
    receipt:{
      ...receiptBase,
      receipt_sha256:sha256Object(receiptBase)
    }
  };
}

const driver={
  commands:[],
  async execute(patch){
    const receipt={
      id:"windowpilot:1",
      status:"applied",
      patch:JSON.parse(JSON.stringify(patch)),
      ack:{ok:true,command_id:"ack-1"},
      before_tick:10,
      requested_position_pct:Number(patch.value),
      hardware_identity_before:"hw-window-1",
      hardware_identity_after:"hw-window-1",
      readiness_before:{physical_write_ready:true},
      readiness_after:{physical_write_ready:true},
      observation:{
        target:W,
        exists:true,
        slots:{opening:Number(patch.value),power:"ON"},
        evidence:{
          source:"windowpilot:/api/state",
          measured:true,
          tick:11,
          ack_at_ms:100,
          received_at_ms:101,
          position_pct:Number(patch.value)
        }
      }
    };
    this.commands.push(receipt);
    return receipt;
  }
};

const predictor=async()=>({
  decision:"EXECUTE",
  confidence:1,
  patches:[{
    op:"PATCH_SLOT",
    target:W,
    slot:"opening",
    value:5
  }]
});

(async()=>{
  const executionRuntime=new FlyThinkExecutionRuntime({
    runtime:initial,
    driver,
    physicalAuthorizer:authorizer,
    authorizationLedger:ledger(),
    maxUncertainty:1
  });
  const session=new StreamingHomeSession({
    initialRuntime:initial,
    predictor,
    driver,
    executionRuntime
  });

  const partial=await session.process({
    kind:"partial",
    text:"打开",
    turn_id:"live-probe"
  });
  assert.equal(partial.committed,false);
  assert.equal(driver.commands.length,0);
  assert.equal(partial.execution_runtime,null);

  const final=await session.process({
    kind:"final",
    text:"打开客厅窗",
    turn_id:"live-probe"
  });
  assert.equal(final.committed,true);
  assert.equal(driver.commands.length,1);
  assert.ok(final.execution_runtime);
  assert.equal(
    final.execution_runtime.receipt.schema_version,
    "execution-receipt.v1"
  );
  assert.equal(final.execution_runtime.receipt.result,"APPLIED");
  assert.equal(final.execution_runtime.verification.valid,true);
  assert.equal(
    final.execution_runtime.verification.physical_truth_verified,
    true
  );
  assert.equal(final.feedback.length,1);
  assert.equal(final.feedback[0].evidence.measured,true);
  assert.equal(
    final.reconcile.after_device_state[key].slots.opening,
    5
  );
  assert.equal(
    session.history[0].execution_runtime.receipt.receipt_sha256,
    final.execution_runtime.receipt.receipt_sha256
  );

  console.log(JSON.stringify({
    ok:true,
    physical_commands:driver.commands.length,
    partial_commands:0,
    execution_receipt:"verified",
    physical_truth_verified:true
  }));
})().catch(e=>{console.error(e);process.exit(1)});
