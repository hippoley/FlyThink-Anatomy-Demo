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

  // A driver may not redirect a receipt/readback onto another device.
  {
    const wrongDriver={
      execute:async patch=>({
        id:"wrong-target:1",
        status:"applied",
        observation:{
          target:L,
          exists:true,
          slots:{temperature:17},
          evidence:{source:"wrong-driver",measured:true}
        }
      })
    };
    const out=await executePhysicalTurn(
      initial,
      [{op:"PATCH_SLOT",target:B,slot:"temperature",value:19}],
      wrongDriver,
      {turn_id:"turn-wrong-receipt"}
    );
    assert.equal(out.ok,false);
    assert.equal(out.reason,"physical_receipt_target_mismatch");
    assert.equal(out.receipts[0].status,"unsafe");
    assert.equal(out.receipts[0].reason,"physical_receipt_target_mismatch");
    assert.deepEqual(out.receipts[0].expected_target,B);
    assert.equal(
      out.runtime.devices["客厅::空调::default"].slots.temperature,
      24,
      "wrong-device observation must never reconcile"
    );
    assert.equal(
      out.runtime.devices["主卧::空调::default"].slots.temperature,
      25,
      "requested target state must stay unchanged on mismatched receipt"
    );
    assert.equal(isQuarantined(out.runtime,B),true);
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

  // Generic physical UNDO executes the explicit compensation, never the semantic UNDO op.
  {
    const undoRuntime=normalizeRuntime({
      devices:{
        "主卧::空调::default":{
          key:"主卧::空调::default",
          area:"主卧",
          entity:"空调",
          instance:"default",
          slots:{power:"ON",temperature:25}
        }
      },
      executionLedger:[{
        id:"exec:temp-25",
        kind:"physical",
        status:"applied",
        semantic_patch:{op:"PATCH_SLOT",target:B,slot:"temperature",value:25},
        physical_patch:{op:"PATCH_SLOT",target:B,slot:"temperature",value:25},
        observation:{target:B,exists:true,slots:{power:"ON",temperature:25}}
      }]
    });
    const driver=new MockThingDriver(undoRuntime);
    const out=await executePhysicalTurn(undoRuntime,[{
      op:"UNDO_EXECUTED",
      execution_id:"exec:temp-25",
      compensation:{op:"PATCH_SLOT",target:B,slot:"temperature",value:24}
    }],driver,{turn_id:"undo-1"});
    assert.equal(out.ok,true);
    assert.equal(driver.commands.length,1);
    assert.equal(driver.commands[0].patch.op,"PATCH_SLOT");
    assert.equal(driver.commands[0].patch.value,24);
    assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,24);
    assert.equal(out.receipts[0].compensation,true);
    assert.equal(out.receipts[0].undo_execution_id,"exec:temp-25");
    assert.ok(out.runtime.executionLedger.some(
      item=>item.kind==="compensation"&&item.compensates==="exec:temp-25"
    ));
  }

  // Rejected compensation must not be promoted to a successful undo.
  {
    const undoRuntime=normalizeRuntime({
      devices:{
        "主卧::空调::default":{
          key:"主卧::空调::default",
          area:"主卧",
          entity:"空调",
          instance:"default",
          slots:{power:"ON",temperature:25}
        }
      },
      executionLedger:[{
        id:"exec:reject-test",
        kind:"physical",
        status:"applied",
        semantic_patch:{op:"PATCH_SLOT",target:B,slot:"temperature",value:25}
      }]
    });
    const driver=new MockThingDriver(undoRuntime,{reject:()=>true});
    const out=await executePhysicalTurn(undoRuntime,[{
      op:"UNDO_EXECUTED",
      execution_id:"exec:reject-test",
      compensation:{op:"PATCH_SLOT",target:B,slot:"temperature",value:24}
    }],driver);
    assert.equal(out.ok,false);
    assert.equal(out.reason,"undo_compensation_not_applied:rejected");
    assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,25);
    assert.equal(out.runtime.executionLedger.some(
      item=>item.kind==="compensation"&&item.compensates==="exec:reject-test"
    ),false);
  }

  // Physical undo requires an actually-applied physical execution and is single-use.
  {
    const undoRuntime=normalizeRuntime({
      devices:{
        "主卧::空调::default":{
          key:"主卧::空调::default",
          area:"主卧",
          entity:"空调",
          instance:"default",
          slots:{power:"ON",temperature:25}
        }
      },
      executionLedger:[{
        id:"exec:single-use",
        kind:"physical",
        status:"applied",
        semantic_patch:{op:"PATCH_SLOT",target:B,slot:"temperature",value:25}
      }]
    });
    const driver=new MockThingDriver(undoRuntime);
    const first=await executePhysicalTurn(undoRuntime,[{
      op:"UNDO_EXECUTED",
      execution_id:"exec:single-use",
      compensation:{op:"PATCH_SLOT",target:B,slot:"temperature",value:24}
    }],driver);
    await assert.rejects(
      ()=>executePhysicalTurn(first.runtime,[{
        op:"UNDO_EXECUTED",
        execution_id:"exec:single-use",
        compensation:{op:"PATCH_SLOT",target:B,slot:"temperature",value:23}
      }],driver),
      /undo_execution_already_compensated/
    );
    assert.equal(driver.commands.length,1);

    const rejectedPrior=normalizeRuntime(undoRuntime);
    rejectedPrior.executionLedger[0].status="rejected";
    const untouchedDriver=new MockThingDriver(rejectedPrior);
    await assert.rejects(
      ()=>executePhysicalTurn(rejectedPrior,[{
        op:"UNDO_EXECUTED",
        execution_id:"exec:single-use",
        compensation:{op:"PATCH_SLOT",target:B,slot:"temperature",value:24}
      }],untouchedDriver),
      /undo_physical_prior_not_applied/
    );
    assert.equal(untouchedDriver.commands.length,0);
  }

  // Invalid compensation is refused before the side-effecting driver boundary.
  {
    const undoRuntime=normalizeRuntime({
      devices:{
        "主卧::空调::default":{
          key:"主卧::空调::default",
          area:"主卧",
          entity:"空调",
          instance:"default",
          slots:{power:"ON",temperature:25}
        }
      },
      executionLedger:[{
        id:"exec:preflight",
        kind:"physical",
        status:"applied"
      }]
    });
    const driver=new MockThingDriver(undoRuntime);
    await assert.rejects(
      ()=>executePhysicalTurn(undoRuntime,[{
        op:"UNDO_EXECUTED",
        execution_id:"exec:preflight",
        compensation:{
          op:"PATCH_SLOT",
          target:{area:"书房",entity:"空调",instance:"missing"},
          slot:"temperature",
          value:24
        }
      }],driver),
      /patch_target_not_found/
    );
    assert.equal(driver.commands.length,0);
  }

  console.log(JSON.stringify({
    ok:true,
    cases:10,
    contract:"patch->execute->observe->reconcile + persistent quarantine + fail-closed physical compensation"
  }));
})().catch(err=>{console.error(err);process.exit(1)});
