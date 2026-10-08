"use strict";

const assert=require("node:assert/strict");
const {normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {executePhysicalTurn,isQuarantined}=require("./physical_runtime.cjs");

const target={area:"客厅",entity:"窗户",instance:"default"};
const initial=normalizeRuntime({
  devices:{
    "客厅::窗户::default":{
      key:"客厅::窗户::default",
      area:"客厅",
      entity:"窗户",
      instance:"default",
      status:"mounted",
      slots:{opening:0}
    }
  }
});

class EffectThenDisconnectDriver{
  constructor(){
    this.world={opening:0};
    this.effects=0;
  }
  async execute(patch){
    this.effects++;
    this.world.opening=Number(patch.value);
    throw new Error("transport_lost_after_device_effect");
  }
}

(async()=>{
  const driver=new EffectThenDisconnectDriver();
  const out=await executePhysicalTurn(initial,[{
    op:"PATCH_SLOT",
    target,
    slot:"opening",
    value:50,
    turn_id:"truth-probe-1"
  }],driver,{turn_id:"truth-probe-1"});

  assert.equal(driver.effects,1,"physical effect must have happened before transport loss");
  assert.equal(driver.world.opening,50,"device world must show the effect");

  assert.equal(out.ok,false);
  assert.equal(out.reason,"physical_outcome_indeterminate_after_driver_call");
  assert.equal(isQuarantined(out.runtime,target),true);

  const health=out.runtime.deviceHealth["客厅::窗户::default"];
  assert.equal(health.status,"quarantined");
  assert.equal(health.source_status,"indeterminate");
  assert.equal(health.reason,"physical_outcome_indeterminate_after_driver_call");

  assert.equal(out.receipts.length,1);
  assert.equal(out.receipts[0].status,"indeterminate");
  assert.equal(out.receipts[0].observation,null);
  assert.equal(out.receipts[0].transport_error,"transport_lost_after_device_effect");

  const device=out.runtime.devices["客厅::窗户::default"];
  assert.equal(
    device.slots.opening,
    0,
    "logical runtime must not fabricate the unobserved physical result before reconciliation"
  );

  assert.equal(out.runtime.executionLedger.length,1);
  assert.equal(out.runtime.executionLedger[0].status,"indeterminate");

  console.log(JSON.stringify({
    indeterminate_physical_execution_boundary:"PASS",
    physical_effects:driver.effects,
    device_opening:driver.world.opening,
    runtime_quarantined:1,
    fabricated_logical_commit:0,
    automatic_retry_authorized:0,
    reconciliation_required:1
  }));
})().catch(e=>{console.error(e);process.exit(1);});
