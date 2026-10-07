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
  let threw=false;
  let errorMessage=null;
  try{
    await executePhysicalTurn(initial,[{
      op:"PATCH_SLOT",
      target,
      slot:"opening",
      value:50,
      turn_id:"truth-probe-1"
    }],driver,{turn_id:"truth-probe-1"});
  }catch(e){
    threw=true;
    errorMessage=String(e&&e.message||e);
  }

  assert.equal(driver.effects,1,"physical effect must have happened before transport loss");
  assert.equal(driver.world.opening,50,"device world must show the effect");
  assert.equal(threw,true,"current runtime is expected to surface only the transport exception");
  assert.equal(
    isQuarantined(initial,target),
    false,
    "probe documents current gap: runtime has no durable indeterminate/quarantine state after effect-then-error"
  );

  console.log(JSON.stringify({
    indeterminate_physical_execution_gap:"REPRODUCED",
    physical_effects:driver.effects,
    device_opening:driver.world.opening,
    runtime_quarantined:0,
    observed_error:errorMessage,
    safe_automatic_retry:0
  }));
})().catch(e=>{console.error(e);process.exit(1);});
