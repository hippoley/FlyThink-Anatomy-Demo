"use strict";

const {deviceKey}=require("./whole_home_patch_contract.cjs");
const {
  isQuarantined,
  isSafetyReducingPatch,
  reconcileObservation,
  executeSinglePhysicalPatch
}=require("./physical_runtime.cjs");

const CONTRACT_VERSION="recovery-transaction.v1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function pctFromState(state){
  const value=state&&state.thing_model&&state.thing_model.window_open_pct;
  const pct=Number(value);
  return Number.isFinite(pct)?pct:null;
}
function tickFromState(state){
  const tick=Number(state&&state.tick);
  return Number.isFinite(tick)?tick:null;
}
function identityFromReadiness(readiness){
  return readiness&&readiness.hardware_identity&&
    readiness.hardware_identity.identity_sha256||null;
}

function recoveryState(runtime,target){
  const key=deviceKey(target);
  return clone((runtime.deviceHealth||{})[key]||null);
}

function restoreQuarantineAfterVerifiedRecovery(runtime,target,proof){
  const key=deviceKey(target);
  const health=runtime&&runtime.deviceHealth&&runtime.deviceHealth[key];
  if(!health||health.status!=="quarantined"){
    throw new Error("device_not_quarantined");
  }
  const beforeTick=Number(proof&&proof.before_tick);
  const afterTick=Number(proof&&proof.after_tick);
  const safePct=Number(proof&&proof.safe_position_pct);
  const safeMax=Number(proof&&proof.safe_position_max_pct);
  const valid=
    proof&&
    proof.contract_version===CONTRACT_VERSION&&
    proof.target_key===key&&
    proof.verified===true&&
    proof.readiness_verified===true&&
    proof.hardware_identity_verified===true&&
    proof.physical_readback_verified===true&&
    proof.safe_position_verified===true&&
    typeof proof.identity_sha256==="string"&&proof.identity_sha256.length>0&&
    Number.isFinite(beforeTick)&&
    Number.isFinite(afterTick)&&
    afterTick>beforeTick&&
    Number.isFinite(safePct)&&
    Number.isFinite(safeMax)&&
    safePct<=safeMax&&
    typeof proof.execution_receipt_id==="string"&&
    proof.execution_receipt_id.length>0;
  if(!valid){
    throw new Error("recovery_internal_verdict_invalid");
  }
  runtime.deviceHealth[key]={
    status:"healthy",
    recovered_at_turn_id:proof.turn_id||null,
    recovery:clone(proof)
  };
  return runtime.deviceHealth[key];
}

async function runRecoveryTransaction(inputRuntime,{
  target,
  driver,
  safe_patch,
  expected_hardware_identity=null,
  safe_position_max_pct=0,
  turn_id="recovery"
}={}){
  if(!target)throw new Error("recovery_target_required");
  if(!driver||typeof driver.readiness!=="function"||typeof driver.state!=="function"){
    throw new Error("recovery_driver_readiness_state_required");
  }
  if(driver.target&&deviceKey(driver.target)!==deviceKey(target)){
    throw new Error("recovery_driver_target_mismatch");
  }
  if(!safe_patch)throw new Error("recovery_safe_patch_required");
  if(!safe_patch.target||deviceKey(safe_patch.target)!==deviceKey(target)){
    throw new Error("recovery_patch_target_mismatch");
  }
  const safeLimit=Number(safe_position_max_pct);
  if(!Number.isFinite(safeLimit)||safeLimit<0||safeLimit>100){
    throw new Error("recovery_safe_position_limit_invalid");
  }

  let runtime=inputRuntime;
  if(!isQuarantined(runtime,target))throw new Error("device_not_quarantined");
  if(!isSafetyReducingPatch(runtime,safe_patch)){
    throw new Error("recovery_patch_must_reduce_risk");
  }

  const trace=[];
  const readinessBefore=await driver.readiness();
  trace.push({stage:"READINESS_BEFORE",value:clone(readinessBefore)});
  if(!readinessBefore||readinessBefore.physical_write_ready!==true){
    return blocked(runtime,"recovery_readiness_not_verified",trace);
  }

  const identityBefore=identityFromReadiness(readinessBefore);
  if(!identityBefore){
    return blocked(runtime,"recovery_hardware_identity_missing",trace);
  }
  if(expected_hardware_identity&&identityBefore!==expected_hardware_identity){
    return blocked(runtime,"recovery_hardware_identity_mismatch",trace);
  }

  const stateBefore=await driver.state();
  const beforeTick=tickFromState(stateBefore);
  const beforePct=pctFromState(stateBefore);
  trace.push({stage:"READBACK_BEFORE",value:clone(stateBefore)});
  if(beforeTick==null||beforePct==null){
    return blocked(runtime,"recovery_pre_readback_invalid",trace);
  }

  const executed=await executeSinglePhysicalPatch(
    runtime,
    {...clone(safe_patch),turn_id},
    driver,
    {turn_id}
  );
  runtime=executed.runtime;
  const receipt=executed.receipts&&executed.receipts[0]||null;
  trace.push({stage:"SAFETY_ACTION",value:clone(receipt)});
  if(executed.reason==="physical_receipt_target_mismatch"){
    return blocked(runtime,"recovery_receipt_target_mismatch",trace,{receipt});
  }
  if(!executed.ok||!receipt||receipt.status!=="applied"){
    return blocked(runtime,"recovery_safety_action_not_applied",trace,{receipt});
  }
  const receiptTarget=
    receipt.observation&&receipt.observation.target||null;
  const receiptPhysicalTarget=
    receipt.physical_patch&&receipt.physical_patch.target||null;
  if(
    !receiptTarget||
    deviceKey(receiptTarget)!==deviceKey(target)||
    !receiptPhysicalTarget||
    deviceKey(receiptPhysicalTarget)!==deviceKey(target)
  ){
    return blocked(runtime,"recovery_receipt_target_mismatch",trace,{receipt});
  }

  const stateAfter=await driver.state();
  const afterTick=tickFromState(stateAfter);
  const afterPct=pctFromState(stateAfter);
  trace.push({stage:"READBACK_AFTER",value:clone(stateAfter)});
  if(afterTick==null||afterTick<=beforeTick){
    return blocked(runtime,"recovery_post_readback_not_fresh",trace,{receipt});
  }
  if(afterPct==null||afterPct>safeLimit){
    return blocked(runtime,"recovery_safe_position_not_verified",trace,{receipt});
  }

  runtime=reconcileObservation(runtime,{
    target:clone(target),
    exists:true,
    slots:{opening:afterPct}
  },turn_id);
  trace.push({
    stage:"FINAL_STATE_RECONCILED",
    value:{target:clone(target),opening:afterPct,tick:afterTick}
  });

  const readinessAfter=await driver.readiness();
  trace.push({stage:"READINESS_AFTER",value:clone(readinessAfter)});
  if(!readinessAfter||readinessAfter.physical_write_ready!==true){
    return blocked(runtime,"recovery_post_readiness_not_verified",trace,{receipt});
  }
  const identityAfter=identityFromReadiness(readinessAfter);
  if(!identityAfter||identityAfter!==identityBefore){
    return blocked(runtime,"recovery_hardware_identity_changed",trace,{receipt});
  }
  if(expected_hardware_identity&&identityAfter!==expected_hardware_identity){
    return blocked(runtime,"recovery_hardware_identity_mismatch",trace,{receipt});
  }

  const proof={
    contract_version:CONTRACT_VERSION,
    target_key:deviceKey(target),
    verified:true,
    turn_id,
    readiness_verified:true,
    hardware_identity_verified:true,
    physical_readback_verified:true,
    safe_position_verified:true,
    identity_sha256:identityAfter,
    before_tick:beforeTick,
    after_tick:afterTick,
    safe_position_pct:afterPct,
    safe_position_max_pct:safeLimit,
    execution_receipt_id:receipt.command_id||null
  };
  restoreQuarantineAfterVerifiedRecovery(runtime,target,proof);
  trace.push({stage:"TRUST_RESTORED",value:clone(proof)});

  return {
    ok:true,
    contract_version:CONTRACT_VERSION,
    status:"RECOVERED",
    reason:null,
    runtime,
    target:clone(target),
    receipt:clone(receipt),
    proof,
    trace,
    recovery_state:recoveryState(runtime,target),
    normal_execution_authorized:false
  };
}

function blocked(runtime,reason,trace,extra={}){
  return {
    ok:false,
    contract_version:CONTRACT_VERSION,
    status:"QUARANTINED",
    reason,
    runtime,
    receipt:clone(extra.receipt||null),
    proof:null,
    trace:clone(trace),
    normal_execution_authorized:false
  };
}

module.exports={
  CONTRACT_VERSION,
  runRecoveryTransaction,
  recoveryState,
  pctFromState,
  tickFromState,
  identityFromReadiness
};
