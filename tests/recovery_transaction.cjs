"use strict";

const assert=require("assert");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");
const {markQuarantined,isQuarantined}=require("../scripts/physical_runtime.cjs");
const {runRecoveryTransaction}=require("../scripts/recovery_transaction.cjs");

const target={area:"客厅",entity:"窗",instance:"default"};
const other={area:"卧室",entity:"窗",instance:"default"};
const key="客厅::窗::default";

function baseRuntime(){
  const runtime=normalizeRuntime({devices:{
    [key]:{
      key,
      area:"客厅",
      entity:"窗",
      instance:"default",
      model_id:"CWDS-CA01",
      slots:{opening:40}
    }
  }});
  markQuarantined(
    runtime,
    target,
    {id:"cmd-uncertain",status:"uncertain",reason:"identity_drift"},
    "turn-fail"
  );
  return runtime;
}

function driver({
  beforeTick=10,
  afterTick=11,
  beforePct=40,
  afterPct=0,
  identityBefore="hw-1",
  identityAfter="hw-1",
  readyBefore=true,
  readyAfter=true,
  executeStatus="applied"
}={}){
  let readinessReads=0;
  let stateReads=0;
  return {
    async readiness(){
      readinessReads++;
      return {
        physical_write_ready:readinessReads===1?readyBefore:readyAfter,
        hardware_identity:{
          identity_sha256:readinessReads===1?identityBefore:identityAfter
        }
      };
    },
    async state(){
      stateReads++;
      if(stateReads===1){
        return {tick:beforeTick,thing_model:{window_open_pct:beforePct}};
      }
      return {tick:afterTick,thing_model:{window_open_pct:afterPct}};
    },
    async execute(patch){
      return {
        id:"recovery-cmd-1",
        status:executeStatus,
        patch,
        observation:{
          target,
          exists:true,
          slots:{opening:afterPct},
          evidence:{source:"recovery-test",measured:true,tick:afterTick}
        }
      };
    }
  };
}

(async()=>{
  {
    const runtime=baseRuntime();
    const out=await runRecoveryTransaction(runtime,{
      target,
      driver:driver(),
      safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0},
      expected_hardware_identity:"hw-1",
      safe_position_max_pct:0,
      turn_id:"turn-recovery"
    });
    assert.equal(out.ok,true);
    assert.equal(out.status,"RECOVERED");
    assert.equal(out.contract_version,"recovery-transaction.v1");
    assert.equal(out.proof.verified,true);
    assert.equal(out.proof.target_key,key);
    assert.equal(out.proof.before_tick,10);
    assert.equal(out.proof.after_tick,11);
    assert.equal(out.proof.safe_position_pct,0);
    assert.equal(out.normal_execution_authorized,false);
    assert.equal(isQuarantined(out.runtime,target),false);
    assert.equal(out.runtime.devices[key].slots.opening,0);
    assert.equal(out.recovery_state.status,"healthy");
  }

  {
    const runtime=baseRuntime();
    const out=await runRecoveryTransaction(runtime,{
      target,
      driver:driver({afterTick:10}),
      safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0},
      expected_hardware_identity:"hw-1"
    });
    assert.equal(out.ok,false);
    assert.equal(out.reason,"recovery_post_readback_not_fresh");
    assert.equal(isQuarantined(out.runtime,target),true);
    // The safety-reducing action may have physically landed, but trust is not restored.
    assert.equal(out.runtime.devices[key].slots.opening,0);
  }

  {
    const runtime=baseRuntime();
    const out=await runRecoveryTransaction(runtime,{
      target,
      driver:driver({afterPct:-1}),
      safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0},
      expected_hardware_identity:"hw-1",
      safe_position_max_pct:0
    });
    assert.equal(out.ok,false);
    assert.equal(out.reason,"recovery_safe_position_not_verified");
    assert.equal(out.proof,null);
    assert.equal(isQuarantined(out.runtime,target),true,
      "out-of-range physical readback must not be interpreted as a safer position");
  }

  {
    const runtime=baseRuntime();
    const d=driver({afterPct:0});
    d.execute=async(patch)=>({
      id:"recovery-cmd-stale-observation",
      status:"applied",
      patch,
      observation:{
        target,
        exists:true,
        slots:{opening:5},
        evidence:{source:"recovery-test",measured:true,tick:11}
      }
    });
    const out=await runRecoveryTransaction(runtime,{
      target,
      driver:d,
      safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0},
      expected_hardware_identity:"hw-1"
    });
    assert.equal(out.ok,true);
    // final fresh readback must win over the earlier command observation.
    assert.equal(out.runtime.devices[key].slots.opening,0);
    assert.equal(out.trace.some(x=>x.stage==="FINAL_STATE_RECONCILED"),true);
  }

  {
    const runtime=baseRuntime();
    const out=await runRecoveryTransaction(runtime,{
      target,
      driver:driver({identityAfter:"hw-swapped"}),
      safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0},
      expected_hardware_identity:"hw-1"
    });
    assert.equal(out.ok,false);
    assert.equal(out.reason,"recovery_hardware_identity_changed");
    assert.equal(isQuarantined(out.runtime,target),true);
  }

  {
    const runtime=baseRuntime();
    const out=await runRecoveryTransaction(runtime,{
      target,
      driver:driver({readyBefore:false}),
      safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0}
    });
    assert.equal(out.ok,false);
    assert.equal(out.reason,"recovery_readiness_not_verified");
    assert.equal(isQuarantined(out.runtime,target),true);
    assert.equal(out.trace.length,1);
  }

  {
    const runtime=baseRuntime();
    const out=await runRecoveryTransaction(runtime,{
      target,
      driver:driver({readyBefore:false}),
      safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0},
      proof:{
        verified:true,
        readiness_verified:true,
        hardware_identity_verified:true,
        physical_readback_verified:true,
        safe_position_verified:true
      }
    });
    assert.equal(out.ok,false);
    assert.equal(out.reason,"recovery_readiness_not_verified");
    assert.equal(out.proof,null);
    assert.equal(isQuarantined(out.runtime,target),true,
      "caller-asserted recovery booleans must not restore trust");
  }

  {
    const runtime=baseRuntime();
    await assert.rejects(
      ()=>runRecoveryTransaction(runtime,{
        target,
        driver:driver(),
        safe_patch:{op:"PATCH_SLOT",target:other,slot:"opening",value:0}
      }),
      /recovery_patch_target_mismatch/
    );
    assert.equal(isQuarantined(runtime,target),true);
  }

  {
    const runtime=baseRuntime();
    const wrongDriver=driver();
    wrongDriver.target=other;
    await assert.rejects(
      ()=>runRecoveryTransaction(runtime,{
        target,
        driver:wrongDriver,
        safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0}
      }),
      /recovery_driver_target_mismatch/
    );
    assert.equal(isQuarantined(runtime,target),true);
  }

  {
    const runtime=baseRuntime();
    await assert.rejects(
      ()=>runRecoveryTransaction(runtime,{
        target,
        driver:driver(),
        safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:80}
      }),
      /recovery_patch_must_reduce_risk/
    );
    assert.equal(isQuarantined(runtime,target),true);
  }

  {
    const runtime=baseRuntime();
    const wrongReceiptDriver=driver();
    wrongReceiptDriver.execute=async(patch)=>({
      id:"recovery-cmd-wrong-target",
      status:"applied",
      patch,
      observation:{
        target:other,
        exists:true,
        slots:{opening:0},
        evidence:{source:"recovery-test",measured:true,tick:11}
      }
    });
    const out=await runRecoveryTransaction(runtime,{
      target,
      driver:wrongReceiptDriver,
      safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0}
    });
    assert.equal(out.ok,false);
    assert.equal(out.reason,"recovery_receipt_target_mismatch");
    assert.equal(isQuarantined(out.runtime,target),true);
  }

  {
    const runtime=baseRuntime();
    const out=await runRecoveryTransaction(runtime,{
      target,
      driver:driver({executeStatus:"uncertain"}),
      safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0}
    });
    assert.equal(out.ok,false);
    assert.equal(out.reason,"recovery_safety_action_not_applied");
    assert.equal(isQuarantined(out.runtime,target),true);
  }

  {
    const runtime=baseRuntime();
    await assert.rejects(
      ()=>runRecoveryTransaction(runtime,{
        target,
        driver:driver(),
        safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0},
        safe_position_max_pct:101
      }),
      /recovery_safe_position_limit_invalid/
    );
  }

  {
    const runtime=baseRuntime();
    let boundaryCalls=0;
    const mustNotReach={
      async readiness(){boundaryCalls++;throw new Error("must_not_reach_readiness");},
      async state(){boundaryCalls++;throw new Error("must_not_reach_state");},
      async execute(){boundaryCalls++;throw new Error("must_not_reach_execute");}
    };
    await assert.rejects(
      ()=>runRecoveryTransaction(runtime,{
        target,
        driver:mustNotReach,
        safe_patch:{op:"PATCH_SLOT",target,slot:"opening",value:0},
        safe_position_max_pct:100
      }),
      /recovery_safe_position_policy_override_forbidden/
    );
    assert.equal(boundaryCalls,0,
      "caller-controlled safe threshold must be rejected before any physical/readiness boundary");
    assert.equal(isQuarantined(runtime,target),true);
  }

  console.log(JSON.stringify({
    ok:true,
    cases:14,
    contract:"RecoveryTransaction restores trust only after readiness, same-target safety action, fresh readback, stable identity, and verified safe position"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
