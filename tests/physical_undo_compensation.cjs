"use strict";

const assert=require("assert");
const {
  MockThingDriver,
  executePhysicalTurn
}=require("../scripts/physical_runtime.cjs");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");

const target={area:"主卧",entity:"空调",instance:"default"};
const key="主卧::空调::default";

function runtimeWithAppliedExecution(){
  return normalizeRuntime({
    devices:{
      [key]:{
        key,
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
      semantic_patch:{
        op:"PATCH_SLOT",
        target,
        slot:"temperature",
        value:25
      },
      physical_patch:{
        op:"PATCH_SLOT",
        target,
        slot:"temperature",
        value:25
      },
      observation:{
        target,
        exists:true,
        slots:{power:"ON",temperature:25}
      }
    }]
  });
}

(async()=>{
  // Physical UNDO must send only the explicit compensation to the driver.
  {
    const initial=runtimeWithAppliedExecution();
    const driver=new MockThingDriver(initial);
    const out=await executePhysicalTurn(initial,[{
      op:"UNDO_EXECUTED",
      execution_id:"exec:temp-25",
      compensation:{
        op:"PATCH_SLOT",
        target,
        slot:"temperature",
        value:24
      }
    }],driver,{turn_id:"undo-1"});

    assert.equal(out.ok,true);
    assert.equal(driver.commands.length,1);
    assert.equal(driver.commands[0].patch.op,"PATCH_SLOT");
    assert.equal(driver.commands[0].patch.slot,"temperature");
    assert.equal(driver.commands[0].patch.value,24);
    assert.equal(out.runtime.devices[key].slots.temperature,24);
    assert.equal(out.receipts[0].compensation,true);
    assert.equal(out.receipts[0].undo_execution_id,"exec:temp-25");
    const marker=out.runtime.executionLedger.find(
      item=>item.kind==="compensation"&&item.compensates==="exec:temp-25"
    );
    assert.ok(marker);
    assert.equal(marker.status,"applied");
  }

  // A rejected compensation is not an undo success and must not create marker.
  {
    const initial=runtimeWithAppliedExecution();
    const driver=new MockThingDriver(initial,{reject:()=>true});
    const out=await executePhysicalTurn(initial,[{
      op:"UNDO_EXECUTED",
      execution_id:"exec:temp-25",
      compensation:{
        op:"PATCH_SLOT",
        target,
        slot:"temperature",
        value:24
      }
    }],driver,{turn_id:"undo-rejected"});

    assert.equal(out.ok,false);
    assert.equal(out.reason,"undo_compensation_not_applied:rejected");
    assert.equal(out.runtime.devices[key].slots.temperature,25);
    assert.equal(
      out.runtime.executionLedger.some(item=>item.kind==="compensation"),
      false
    );
  }

  // An execution that was not physically applied cannot be physically undone.
  {
    const initial=runtimeWithAppliedExecution();
    initial.executionLedger[0].status="rejected";
    const driver=new MockThingDriver(initial);
    await assert.rejects(
      ()=>executePhysicalTurn(initial,[{
        op:"UNDO_EXECUTED",
        execution_id:"exec:temp-25",
        compensation:{
          op:"PATCH_SLOT",
          target,
          slot:"temperature",
          value:24
        }
      }],driver),
      /undo_physical_prior_not_applied/
    );
    assert.equal(driver.commands.length,0);
  }

  // Once compensated, the same execution cannot be undone again.
  {
    const initial=runtimeWithAppliedExecution();
    const driver=new MockThingDriver(initial);
    const first=await executePhysicalTurn(initial,[{
      op:"UNDO_EXECUTED",
      execution_id:"exec:temp-25",
      compensation:{
        op:"PATCH_SLOT",
        target,
        slot:"temperature",
        value:24
      }
    }],driver);

    await assert.rejects(
      ()=>executePhysicalTurn(first.runtime,[{
        op:"UNDO_EXECUTED",
        execution_id:"exec:temp-25",
        compensation:{
          op:"PATCH_SLOT",
          target,
          slot:"temperature",
          value:23
        }
      }],driver),
      /undo_execution_already_compensated/
    );
    assert.equal(driver.commands.length,1);
  }

  // Invalid compensation must fail before the physical boundary.
  {
    const initial=runtimeWithAppliedExecution();
    const driver=new MockThingDriver(initial);
    await assert.rejects(
      ()=>executePhysicalTurn(initial,[{
        op:"UNDO_EXECUTED",
        execution_id:"exec:temp-25",
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
    physical_undo_compensation:"PASS",
    semantic_undo_sent_to_driver:0,
    rejected_compensation_promoted:0,
    duplicate_compensation:0,
    invalid_compensation_driver_calls:0
  }));
})().catch(err=>{console.error(err);process.exit(1);});
