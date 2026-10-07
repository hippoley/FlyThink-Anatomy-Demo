"use strict";
const assert = require("assert");
const {
  MockThingDriver,
  executePhysicalTurn,
  isQuarantined,
  clearQuarantine
} = require("../scripts/physical_runtime.cjs");
const {normalizeRuntime} = require("../scripts/whole_home_patch_contract.cjs");
const {
  physicalReceiptsApplied,
  physicalReceiptFailure
} = require("../scripts/stateful_checkpoint_trajectory.cjs");

const L = {area:"客厅",entity:"空调",instance:"default"};
const B = {area:"主卧",entity:"空调",instance:"default"};
const initial = normalizeRuntime({devices:{
  "客厅::空调::default":{key:"客厅::空调::default",area:"客厅",entity:"空调",instance:"default",slots:{power:"ON",temperature:24}},
  "主卧::空调::default":{key:"主卧::空调::default",area:"主卧",entity:"空调",instance:"default",slots:{power:"ON",temperature:25}}
}});

(async()=>{
  // Accepted relative action: physical observation is authoritative.
  {
    const driver = new MockThingDriver(initial);
    const out = await executePhysicalTurn(initial,[{op:"PATCH_RELATIVE",target:B,slot:"temperature",delta:-1}],driver);
    assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,24);
    assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,24);
    assert.equal(out.receipts[0].status,"applied");
    assert.equal(out.runtime.executionLedger.length,1);
    assert.equal(out.runtime.executionLedger[0].status,"applied");
  }

  // Device rejection: requested state must not leak into observed runtime.
  {
    const driver = new MockThingDriver(initial,{reject:p=>p.target && p.target.area==="主卧"});
    const out = await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target:B,slot:"temperature",value:19}],driver);
    assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,25);
    assert.equal(out.receipts[0].status,"rejected");
    assert.equal(out.runtime.executionLedger.length,1);
    assert.equal(out.runtime.executionLedger[0].status,"rejected");
  }

  // Physical device may clamp a request; reconciled state follows observation, not desire.
  {
    const driver = new MockThingDriver(initial,{
      transform:p => p.op==="PATCH_SLOT" && p.slot==="temperature" && p.value<18 ? {value:18} : null
    });
    const out = await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target:B,slot:"temperature",value:15}],driver);
    assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,18);
    assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,24);
    assert.equal(out.receipts[0].physical_patch.value,15);
    assert.equal(out.receipts[0].observation.slots.temperature,18);
  }

  // Uncertain execution quarantines the device persistently.
  {
    const W={area:"客厅",entity:"窗",instance:"default"};
    const wk="客厅::窗::default";
    const windowRuntime=normalizeRuntime({devices:{
      [wk]:{
        key:wk,area:"客厅",entity:"窗",instance:"default",
        model_id:"CWDS-CA01",slots:{opening:0,power:"OFF"}
      }
    }});
    let calls=0;
    const uncertainDriver={
      execute:async patch=>{
        calls++;
        return {
          id:"real:1",
          status:"uncertain",
          reason:"hardware_identity_changed_after_actuation",
          observation:{
            target:patch.target,
            exists:true,
            slots:{opening:5,power:"ON"},
            evidence:{source:"windowpilot:/api/state",measured:true}
          }
        };
      }
    };
    const first=await executePhysicalTurn(
      windowRuntime,
      [{op:"PATCH_SLOT",target:W,slot:"opening",value:5}],
      uncertainDriver,
      {turn_id:"turn-unsafe"}
    );
    assert.equal(first.receipts[0].status,"uncertain");
    assert.equal(isQuarantined(first.runtime,W),true);
    assert.equal(first.runtime.deviceHealth[wk].reason,"hardware_identity_changed_after_actuation");

    const blocked=await executePhysicalTurn(
      first.runtime,
      [{op:"PATCH_SLOT",target:W,slot:"opening",value:20}],
      uncertainDriver,
      {turn_id:"turn-blocked"}
    );
    assert.equal(blocked.receipts[0].status,"blocked");
    assert.equal(blocked.receipts[0].reason,"device_quarantined");
    assert.equal(calls,1,"quarantined opening must not reach physical driver");
    assert.equal(isQuarantined(blocked.runtime,W),true);

    const recoveryDriver={
      execute:async patch=>{
        calls++;
        return {
          id:"real:close",
          status:"applied",
          observation:{
            target:patch.target,
            exists:true,
            slots:{opening:0,power:"OFF"},
            evidence:{source:"windowpilot:/api/state",measured:true}
          }
        };
      }
    };
    const closed=await executePhysicalTurn(
      blocked.runtime,
      [{op:"PATCH_SLOT",target:W,slot:"opening",value:0}],
      recoveryDriver,
      {turn_id:"turn-close"}
    );
    assert.equal(closed.receipts[0].status,"applied");
    assert.equal(closed.runtime.devices[wk].slots.opening,0);
    assert.equal(isQuarantined(closed.runtime,W),true,
      "safe close must not silently clear quarantine");

    assert.throws(
      ()=>clearQuarantine(closed.runtime,W,{verified:false}),
      /quarantine_recovery_proof_required/
    );
    clearQuarantine(closed.runtime,W,{
      verified:true,
      turn_id:"turn-recovery",
      readiness_verified:true,
      hardware_identity_verified:true,
      physical_readback_verified:true,
      safe_position_verified:true
    });
    assert.equal(isQuarantined(closed.runtime,W),false);
    assert.equal(closed.runtime.deviceHealth[wk].status,"healthy");
  }

  // Stateful checkpoint commit semantics reject every non-applied physical receipt.
  {
    assert.equal(physicalReceiptsApplied([{status:"applied"}]),true);
    assert.equal(physicalReceiptsApplied([{local_only:true}]),true);
    assert.equal(physicalReceiptsApplied([{status:"blocked"}]),false);
    assert.equal(physicalReceiptsApplied([{status:"uncertain"}]),false);
    assert.equal(physicalReceiptsApplied([{status:"unsafe"}]),false);
    assert.equal(
      physicalReceiptFailure([{status:"blocked"},{status:"unsafe"}]),
      "physical_receipt_not_applied:blocked,unsafe"
    );
  }

  console.log(JSON.stringify({
    ok:true,
    cases:5,
    contract:"patch->execute->observe->reconcile + persistent quarantine + non-applied receipts never commit"
  }));
})().catch(err=>{console.error(err);process.exit(1)});
