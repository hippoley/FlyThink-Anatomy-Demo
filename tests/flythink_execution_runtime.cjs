"use strict";

const assert=require("assert");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");
const {toContextStateSnapshot}=require("../scripts/contextual_edge_slu_adapter.cjs");
const {runtimeRegistryDigest}=require("../scripts/spatialruntime_authorizer.cjs");
const {MockThingDriver,isQuarantined,markQuarantined}=require("../scripts/physical_runtime.cjs");
const {
  validateExecutionProposal
}=require("../scripts/execution_reasoning_contract.cjs");
const {
  runExecutionProposal,
  FlyThinkExecutionRuntime,
  verifyExecutionReceipt,
  sha256Object
}=require("../scripts/flythink_execution_runtime.cjs");

const L={area:"客厅",entity:"空调",instance:"default"};
const B={area:"主卧",entity:"空调",instance:"default"};
const initial=normalizeRuntime({devices:{
  "客厅::空调::default":{
    key:"客厅::空调::default",area:"客厅",entity:"空调",instance:"default",
    model_id:"AWGD-ZA01",slots:{power:"ON",temperature:24}
  },
  "主卧::空调::default":{
    key:"主卧::空调::default",area:"主卧",entity:"空调",instance:"default",
    model_id:"AWGD-ZA01",slots:{power:"ON",temperature:25}
  }
}});
const context=toContextStateSnapshot(initial,[],{
  conversation_id:"conv-1",
  active_task_id:"task-1"
});

function request(actions,targets=[B]){
  return {
    request_version:"flythink-execution-request.v1",
    task_id:"task-1",
    goal:{type:"desired_state",metric:"comfort"},
    resolved_targets:targets,
    constraints:[],
    candidate_actions:actions
  };
}
function proposal(actions,{
  decision="PROPOSE",
  uncertainty=0.1,
  task_id="task-1"
}={}){
  return {
    schema_version:"flythink-execution-proposal.v1",
    task_id,
    decision,
    strategy:{kind:"test"},
    proposed_actions:actions,
    uncertainty:{score:uncertainty,reasons:[]},
    evidence_refs:["test:evidence"],
    reason_code:"TEST"
  };
}
function freshLedger(){
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
function passAuthorizer(counter=null,transform=null,authorizationId=null,override={}){
  return async({patches,runtime,event,source_step,source_revision})=>{
    if(counter)counter.calls++;
    const out=patches.map(p=>transform?transform(p):p);
    const patchDigest=sha256Object(out);
    const registryDigest=runtimeRegistryDigest(runtime);
    const receiptBase={
      schema:"test-authorization-v1",
      allow:true,
      id:"auth-1",
      patch_digest:patchDigest,
      registry_digest:registryDigest,
      authorization_id:authorizationId||sha256Object({
        fixture:"authorization-v1",
        patch_digest:patchDigest,
        registry_digest:registryDigest
      }),
      single_use:true,
      case_id:String(event&&event.turn_id||""),
      source_step:Number(source_step||0),
      source_revision:Number(source_revision||0),
      authorized_patches:out,
      ...override
    };
    return {
      allow:true,
      patches:out,
      receipt:{
        ...receiptBase,
        receipt_sha256:sha256Object(receiptBase)
      }
    };
  };
}

(async()=>{
  // 1. Single action: authorizer may narrow value but never identity.
  {
    const action={op:"PATCH_SLOT",target:B,slot:"temperature",value:19};
    const driver=new MockThingDriver(initial);
    const auth={calls:0};
    const out=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request([action]),
      proposal:proposal([action]),
      driver,
      physicalAuthorizer:passAuthorizer(auth,p=>({...p,value:20})),
      authorizationLedger:freshLedger(),
    });
    assert.equal(out.ok,true);
    assert.equal(out.status,"EXECUTED");
    assert.equal(auth.calls,1);
    assert.equal(driver.commands.length,1);
    assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,20);
    assert.equal(out.authorized_actions[0].value,20);
    assert.equal(out.receipt.schema_version,"execution-receipt.v1");
    assert.equal(out.receipt.authorization_granted,true);
    assert.equal(out.receipt.physical_committed,true);
    assert.equal(out.receipt.atomic_batch,false);
    assert.equal(out.receipt.result,"APPLIED_UNVERIFIED");
    assert.equal(out.receipt.verification.physical_truth_verified,false);
    assert.match(out.receipt.receipt_sha256,/^[0-9a-f]{64}$/);
    const verifiedReceipt=verifyExecutionReceipt(out.receipt,{
      before_runtime:initial,
      after_runtime:out.runtime
    });
    assert.equal(verifiedReceipt.valid,true);
    assert.equal(verifiedReceipt.physical_truth_verified,false);
  }

  // 2. DEFER never reaches authorization or the driver.
  {
    const action={op:"PATCH_SLOT",target:B,slot:"temperature",value:19};
    const driver=new MockThingDriver(initial);
    const auth={calls:0};
    const out=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request([action]),
      proposal:proposal([],{decision:"DEFER",uncertainty:0.8}),
      driver,
      physicalAuthorizer:passAuthorizer(auth),
      authorizationLedger:freshLedger(),
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"DEFERRED");
    assert.equal(auth.calls,0);
    assert.equal(driver.commands.length,0);
  }

  // 3. High uncertainty PROPOSE is deterministically deferred pre-authorization.
  {
    const action={op:"PATCH_SLOT",target:B,slot:"temperature",value:19};
    const driver=new MockThingDriver(initial);
    const auth={calls:0};
    const out=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request([action]),
      proposal:proposal([action],{uncertainty:0.9}),
      driver,
      physicalAuthorizer:passAuthorizer(auth),
      authorizationLedger:freshLedger(),
      max_uncertainty:0.35
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"DEFERRED");
    assert.equal(out.reason,"reasoning_uncertainty_above_threshold");
    assert.equal(auth.calls,0);
    assert.equal(driver.commands.length,0);
  }

  // 4. Missing physical driver fails before authorization.
  {
    const action={op:"PATCH_SLOT",target:B,slot:"temperature",value:19};
    const auth={calls:0};
    const out=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request([action]),
      proposal:proposal([action]),
      driver:null,
      physicalAuthorizer:passAuthorizer(auth),
      authorizationLedger:freshLedger(),
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"BLOCKED");
    assert.equal(out.reason,"physical_driver_required");
    assert.equal(auth.calls,0);
  }

  // 5. Authorizer cannot redirect the proposal to another target.
  {
    const action={op:"PATCH_SLOT",target:B,slot:"temperature",value:19};
    const driver=new MockThingDriver(initial);
    const out=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request([action]),
      proposal:proposal([action]),
      driver,
      physicalAuthorizer:passAuthorizer(null,p=>({...p,target:L})),
      authorizationLedger:freshLedger(),
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"BLOCKED");
    assert.equal(out.reason,"physical_authorization_invalid");
    assert.match(out.authorization_error,/patch_identity_mismatch/);
    assert.equal(driver.commands.length,0);
  }

  // 6. Authorization cannot transform a quarantine-safe action into a riskier one.
  {
    const W={area:"客厅",entity:"窗",instance:"default"};
    const wk="客厅::窗::default";
    const quarantined=normalizeRuntime({devices:{
      [wk]:{
        key:wk,area:"客厅",entity:"窗",instance:"default",
        model_id:"CWDS-CA01",
        slots:{opening:40}
      }
    }});
    markQuarantined(
      quarantined,
      W,
      {id:"unsafe:q",status:"unsafe",reason:"readback_timeout"},
      "turn-q"
    );
    let driverCalls=0;
    const driver={
      async execute(){
        driverCalls++;
        throw new Error("must_not_execute");
      }
    };
    const safe={op:"PATCH_SLOT",target:W,slot:"opening",value:0};
    const ledger=freshLedger();
    const out=await runExecutionProposal({
      runtime:quarantined,
      contextual_state:toContextStateSnapshot(quarantined,[],{
        conversation_id:"conv-q",
        active_task_id:"task-1"
      }),
      request:request([safe],[W]),
      proposal:proposal([safe]),
      driver,
      physicalAuthorizer:passAuthorizer(null,p=>({...p,value:80})),
      authorizationLedger:ledger
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"BLOCKED");
    assert.equal(out.reason,"authorized_patch_violates_quarantine");
    assert.equal(out.authorization_consumed,true);
    assert.equal(driverCalls,0);
    assert.equal(isQuarantined(out.runtime,W),true);
    assert.equal(out.runtime.devices[wk].slots.opening,40);
  }

  // 7. Multi-action plans require atomic capability; never sequential fallback.
  {
    const actions=[
      {op:"PATCH_SLOT",target:L,slot:"temperature",value:22},
      {op:"PATCH_SLOT",target:B,slot:"temperature",value:22}
    ];
    let sequential=0;
    const driver={
      capabilities(){return []},
      execute(){sequential++;throw new Error("must_not_run")}
    };
    const out=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request(actions,[L,B]),
      proposal:proposal(actions),
      driver,
      physicalAuthorizer:passAuthorizer(),
      authorizationLedger:freshLedger(),
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"PHYSICAL_NOT_COMMITTED");
    assert.equal(out.reason,"physical_capability_not_declared:atomic_multi_target_set");
    assert.equal(out.atomic_batch,true);
    assert.equal(sequential,0);
    assert.deepEqual(out.runtime,initial);
  }

  // 8. Multi-action plan commits once through an atomic batch driver.
  {
    const actions=[
      {op:"PATCH_SLOT",target:L,slot:"temperature",value:22},
      {op:"PATCH_SLOT",target:B,slot:"temperature",value:22}
    ];
    let batches=0;
    const driver={
      capabilities(){return ["atomic_multi_target_set","readback"]},
      async executeAtomicBatch(patches){
        batches++;
        return patches.map((p,i)=>({
          id:"atomic:"+String(i+1),
          status:"applied",
          observation:{target:p.target,exists:true,slots:{temperature:p.value}}
        }));
      }
    };
    const out=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request(actions,[L,B]),
      proposal:proposal(actions),
      driver,
      physicalAuthorizer:passAuthorizer(),
      authorizationLedger:freshLedger(),
    });
    assert.equal(out.ok,true);
    assert.equal(out.atomic_batch,true);
    assert.equal(batches,1);
    assert.equal(out.physical_receipts.length,2);
    assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
    assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,22);
    assert.equal(out.receipt.physical_committed,true);
  }

  // 9. A wrong-device physical readback fails closed and quarantines expected target.
  {
    const action={op:"PATCH_SLOT",target:B,slot:"temperature",value:19};
    const driver={
      async execute(patch){
        return {
          id:"wrong-target",
          status:"applied",
          observation:{target:L,exists:true,slots:{temperature:17}}
        };
      }
    };
    const out=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request([action]),
      proposal:proposal([action]),
      driver,
      physicalAuthorizer:passAuthorizer(),
      authorizationLedger:freshLedger(),
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"PHYSICAL_NOT_COMMITTED");
    assert.equal(out.reason,"physical_receipt_target_mismatch");
    assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,24);
    assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,25);
    assert.equal(isQuarantined(out.runtime,B),true);
  }

  // 10. A proposal cannot select two alternatives for the same action identity.
  {
    const a={op:"PATCH_SLOT",target:B,slot:"temperature",value:20};
    const b={op:"PATCH_SLOT",target:B,slot:"temperature",value:22};
    assert.throws(
      ()=>validateExecutionProposal(
        proposal([a,b]),
        request([a,b])
      ),
      /conflicting_proposed_action_identity/
    );
  }

  // 10. WindowPilot-like causal evidence upgrades the receipt to verified physical truth.
  {
    const W={area:"客厅",entity:"窗",instance:"default"};
    const wk="客厅::窗::default";
    const windowRuntime=normalizeRuntime({devices:{
      [wk]:{
        key:wk,area:"客厅",entity:"窗",instance:"default",
        model_id:"CWDS-CA01",slots:{opening:0}
      }
    }});
    const windowContext=toContextStateSnapshot(windowRuntime,[],{
      conversation_id:"conv-window",
      active_task_id:"task-window"
    });
    const windowAction={op:"PATCH_SLOT",target:W,slot:"opening",value:5};
    const windowRequest={
      request_version:"flythink-execution-request.v1",
      task_id:"task-window",
      goal:{type:"desired_state",metric:"ventilation"},
      resolved_targets:[W],
      constraints:[],
      candidate_actions:[windowAction]
    };
    const windowProposal={
      schema_version:"flythink-execution-proposal.v1",
      proposal_id:"proposal-window",
      task_id:"task-window",
      decision:"PROPOSE",
      strategy:{kind:"bounded-open"},
      proposed_actions:[windowAction],
      uncertainty:{score:0.1,reasons:[]},
      evidence_refs:["sensor:co2"],
      reason_code:"HIGH_CO2"
    };
    const driver={
      async execute(patch){
        return {
          id:"windowpilot:verified",
          status:"applied",
          patch,
          ack:{ok:true,command_id:"ack-window"},
          before_tick:10,
          requested_position_pct:5,
          hardware_identity_before:"hw-window-1",
          hardware_identity_after:"hw-window-1",
          readiness_before:{physical_write_ready:true},
          readiness_after:{physical_write_ready:true},
          observation:{
            target:W,
            exists:true,
            slots:{opening:5},
            evidence:{
              source:"windowpilot:/api/state",
              measured:true,
              tick:11,
              ack_at_ms:1000,
              received_at_ms:1001
            }
          }
        };
      }
    };
    const out=await runExecutionProposal({
      runtime:windowRuntime,
      contextual_state:windowContext,
      request:windowRequest,
      proposal:windowProposal,
      driver,
      physicalAuthorizer:passAuthorizer(),
      authorizationLedger:freshLedger(),
    });
    assert.equal(out.ok,true);
    assert.equal(out.receipt.result,"APPLIED");
    assert.equal(out.receipt.verification.physical_truth_verified,true);
    const verifiedReceipt=verifyExecutionReceipt(out.receipt,{
      contextual_state:windowContext,
      request:windowRequest,
      proposal:windowProposal,
      before_runtime:windowRuntime,
      after_runtime:out.runtime
    });
    assert.equal(verifiedReceipt.valid,true);
    assert.equal(verifiedReceipt.physical_truth_verified,true);
  }

  // 12. Missing authorization ledger blocks before physical execution.
  {
    const action={op:"PATCH_SLOT",target:B,slot:"temperature",value:19};
    const driver=new MockThingDriver(initial);
    const out=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request([action]),
      proposal:proposal([action]),
      driver,
      physicalAuthorizer:passAuthorizer()
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"BLOCKED");
    assert.equal(out.reason,"authorization_ledger_required");
    assert.equal(driver.commands.length,0);
  }

  // 13. Replay of the same authorization id is rejected before a second physical command.
  {
    const action={op:"PATCH_SLOT",target:B,slot:"temperature",value:19};
    const driver=new MockThingDriver(initial);
    const ledger=freshLedger();
    const authorizationId="b".repeat(64);
    const authorizer=passAuthorizer(null,null,authorizationId);
    const first=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request([action]),
      proposal:proposal([action]),
      driver,
      physicalAuthorizer:authorizer,
      authorizationLedger:ledger
    });
    assert.equal(first.ok,true);
    assert.equal(driver.commands.length,1);

    const second=await runExecutionProposal({
      runtime:initial,
      contextual_state:context,
      request:request([action]),
      proposal:proposal([action]),
      driver,
      physicalAuthorizer:authorizer,
      authorizationLedger:ledger
    });
    assert.equal(second.ok,false);
    assert.equal(second.status,"BLOCKED");
    assert.equal(second.reason,"physical_authorization_replayed");
    assert.equal(driver.commands.length,1);
  }

  // 13. Runtime facade exposes the formal recovery path, not manual trust clearing.
  {
    const W={area:"客厅",entity:"窗",instance:"default"};
    const wk="客厅::窗::default";
    const windowRuntime=normalizeRuntime({devices:{
      [wk]:{
        key:wk,area:"客厅",entity:"窗",instance:"default",
        slots:{opening:40}
      }
    }});
    markQuarantined(
      windowRuntime,W,
      {id:"unsafe:1",status:"unsafe",reason:"timeout"},
      "turn-fail"
    );
    let readinessReads=0,stateReads=0;
    const recoveryDriver={
      target:W,
      async readiness(){
        readinessReads++;
        return {
          physical_write_ready:true,
          hardware_identity:{identity_sha256:"hw-1"}
        };
      },
      async state(){
        stateReads++;
        return stateReads===1
          ?{tick:10,thing_model:{window_open_pct:40}}
          :{tick:11,thing_model:{window_open_pct:0}};
      },
      async execute(patch){
        return {
          id:"recover:1",
          status:"applied",
          observation:{target:W,exists:true,slots:{opening:0}}
        };
      }
    };
    const runtime=new FlyThinkExecutionRuntime({
      runtime:windowRuntime,
      driver:recoveryDriver,
      physicalAuthorizer:passAuthorizer(),
      authorizationLedger:freshLedger(),
    });
    const out=await runtime.recover({
      target:W,
      safe_patch:{op:"PATCH_SLOT",target:W,slot:"opening",value:0},
      expected_hardware_identity:"hw-1",
      safe_position_max_pct:0,
      turn_id:"recovery-1"
    });
    assert.equal(out.ok,true);
    assert.equal(out.status,"RECOVERED");
    assert.equal(isQuarantined(runtime.snapshot(),W),false);
  }

  // 15. Authorization receipt integrity is mandatory before actuation.
  {
    const action={op:"PATCH_SLOT",target:B,slot:"temperature",value:19};

    async function runWithAuthorizer(authorizer){
      const driver=new MockThingDriver(initial);
      const out=await runExecutionProposal({
        runtime:initial,
        contextual_state:context,
        request:request([action]),
        proposal:proposal([action]),
        driver,
        physicalAuthorizer:authorizer,
        authorizationLedger:freshLedger()
      });
      assert.equal(out.ok,false);
      assert.equal(out.status,"BLOCKED");
      assert.equal(out.reason,"physical_authorization_invalid");
      assert.equal(driver.commands.length,0);
      return out;
    }

    let out=await runWithAuthorizer(
      passAuthorizer(null,null,null,{
        registry_digest:"f".repeat(64)
      })
    );
    assert.match(out.authorization_error,/registry_digest_mismatch/);

    out=await runWithAuthorizer(
      passAuthorizer(null,null,null,{
        authorized_patches:[{
          op:"PATCH_SLOT",target:B,slot:"temperature",value:17
        }]
      })
    );
    assert.match(out.authorization_error,/receipt_patches_mismatch/);

    const tamperedShaAuthorizer=async({patches,runtime,event,source_step,source_revision})=>{
      const base={
        schema:"test-authorization-v1",
        allow:true,
        patch_digest:sha256Object(patches),
        registry_digest:runtimeRegistryDigest(runtime),
        authorization_id:"c".repeat(64),
        single_use:true,
        case_id:String(event&&event.turn_id||""),
        source_step:Number(source_step||0),
        source_revision:Number(source_revision||0),
        authorized_patches:patches
      };
      return {
        allow:true,
        patches,
        receipt:{...base,receipt_sha256:"d".repeat(64)}
      };
    };
    out=await runWithAuthorizer(tamperedShaAuthorizer);
    assert.match(out.authorization_error,/receipt_sha256_mismatch/);

    out=await runWithAuthorizer(
      passAuthorizer(null,null,null,{authorization_id:"not-a-digest"})
    );
    assert.match(out.authorization_error,/authorization_id_invalid/);

    out=await runWithAuthorizer(
      passAuthorizer(null,null,null,{allow:false})
    );
    assert.match(out.authorization_error,/receipt_not_allowed/);
  }

  console.log(JSON.stringify({
    ok:true,
    cases:16,
    contract:"contextual execution proposal -> deterministic authorization -> atomic/single physical execution -> readback, with formal recovery"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
