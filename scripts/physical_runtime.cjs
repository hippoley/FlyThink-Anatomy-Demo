"use strict";

const {deviceKey, normalizeRuntime, expandSetPatch, applyPatch} = require("./whole_home_patch_contract.cjs");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function activeDevice(runtime, target) {
  return (runtime.devices || {})[deviceKey(target)] || null;
}

function deviceHealth(runtime,target){
  return (runtime.deviceHealth||{})[deviceKey(target)]||null;
}

function isQuarantined(runtime,target){
  const health=deviceHealth(runtime,target);
  return !!health&&health.status==="quarantined";
}

function isSafetyReducingPatch(runtime,patch){
  if(!patch||!patch.target)return false;
  if(patch.op==="CLOSE_DEVICE")return true;
  if(patch.op!=="PATCH_SLOT")return false;
  if(patch.slot==="power"){
    return patch.value==="OFF"||patch.value===false||patch.value===0;
  }
  if(["opening","window_open_pct","position","position_pct"].includes(patch.slot)){
    const device=activeDevice(runtime,patch.target);
    const slots=device&&device.slots||{};
    const before=slots.opening ?? slots.window_open_pct ?? slots.position ?? slots.position_pct;
    const next=Number(patch.value);
    return Number.isFinite(Number(before))&&Number.isFinite(next)&&next<=Number(before);
  }
  return false;
}

function markQuarantined(runtime,target,command,turnId){
  const key=deviceKey(target);
  runtime.deviceHealth[key]={
    status:"quarantined",
    reason:command&&command.reason||command&&command.status||"physical_state_uncertain",
    source_status:command&&command.status||"unknown",
    command_id:command&&command.id||null,
    since_turn_id:turnId||null
  };
  return runtime.deviceHealth[key];
}

function clearQuarantine(runtime,target,recoveryProof){
  const key=deviceKey(target);
  if(!runtime.deviceHealth[key]||runtime.deviceHealth[key].status!=="quarantined"){
    throw new Error("device_not_quarantined");
  }
  const validProof=
    recoveryProof&&
    recoveryProof.verified===true&&
    recoveryProof.readiness_verified===true&&
    recoveryProof.hardware_identity_verified===true&&
    recoveryProof.physical_readback_verified===true&&
    recoveryProof.safe_position_verified===true;
  if(!validProof){
    throw new Error("quarantine_recovery_proof_required");
  }
  runtime.deviceHealth[key]={
    status:"healthy",
    recovered_at_turn_id:recoveryProof.turn_id||null,
    recovery:clone(recoveryProof)
  };
  return runtime.deviceHealth[key];
}

function evaluateQuarantinePreflight(runtime,patches){
  const normalized=normalizeRuntime(runtime);
  const violations=[];
  for(const proposed of patches||[]){
    for(const expanded of expandSetPatch(proposed)){
      if(["CANCEL_PENDING","PROTECT"].includes(expanded.op))continue;
      let physicalPatch;
      try{
        physicalPatch=materializePatch(normalized,expanded);
      }catch(e){
        continue;
      }
      if(
        physicalPatch.target &&
        isQuarantined(normalized,physicalPatch.target) &&
        !isSafetyReducingPatch(normalized,physicalPatch)
      ){
        violations.push({
          reason:"device_quarantined",
          device_key:deviceKey(physicalPatch.target),
          semantic_patch:clone(expanded),
          physical_patch:clone(physicalPatch)
        });
      }
    }
  }
  return {
    allow:violations.length===0,
    reason:violations.length?"device_quarantined":null,
    violations
  };
}

function expectedObservationTarget(patch){
  if(!patch)return null;
  if(patch.op==="REPLACE_TARGET")return patch.to||null;
  return patch.target||null;
}

function materializePatch(runtime, patch) {
  if (!patch) throw new Error("physical_patch_required");
  if (patch.op === "PATCH_RELATIVE") {
    const device = activeDevice(runtime, patch.target);
    if (!device || !Object.prototype.hasOwnProperty.call(device.slots || {}, patch.slot)) {
      throw new Error("relative_patch_requires_existing_value");
    }
    const before = device.slots[patch.slot];
    if (typeof before !== "number" || typeof patch.delta !== "number") {
      throw new Error("relative_patch_requires_numeric_values");
    }
    return {...clone(patch), op: "PATCH_SLOT", value: before + patch.delta, source_op: "PATCH_RELATIVE"};
  }
  if (patch.op === "CLOSE_DEVICE") {
    return {
      ...clone(patch),
      op: "PATCH_SLOT",
      slot: patch.slot || "power",
      value: patch.value === undefined ? "OFF" : patch.value,
      source_op: "CLOSE_DEVICE"
    };
  }
  return clone(patch);
}

class MockThingDriver {
  constructor(initialRuntime = {}, options = {}) {
    this.world = normalizeRuntime(initialRuntime);
    this.options = options;
    this.commands = [];
  }

  execute(patch) {
    const before = normalizeRuntime(this.world);
    const effective = clone(patch);
    const commandId = "mock:" + (this.commands.length + 1);

    if (this.options.reject && this.options.reject(effective, before)) {
      const observation = this.observePatch(effective);
      const receipt = {id: commandId, status: "rejected", patch: effective, observation};
      this.commands.push(receipt);
      return receipt;
    }

    if (this.options.transform) {
      const transformed = this.options.transform(effective, before);
      if (transformed) Object.assign(effective, transformed);
    }

    const applied = applyPatch(this.world, effective);
    this.world = applied.runtime;
    const observation = this.observePatch(effective);
    const receipt = {id: commandId, status: "applied", patch: effective, observation};
    this.commands.push(receipt);
    return receipt;
  }

  observePatch(patch) {
    if (patch.op === "REMOVE_DEVICE") {
      return {target: clone(patch.target), exists: false, slots: null};
    }
    if (patch.op === "REPLACE_TARGET") {
      const target = patch.to;
      const device = activeDevice(this.world, target);
      return {target: clone(target), exists: !!device, slots: clone(device ? device.slots : {})};
    }
    const target = patch.target;
    if (!target) return {target: null, exists: true, slots: {}};
    const device = activeDevice(this.world, target);
    return {target: clone(target), exists: !!device, slots: clone(device ? device.slots : {})};
  }
}

function reconcileObservation(runtime, observation, turnId = null) {
  let next = normalizeRuntime(runtime);
  if (!observation || !observation.target) return next;
  const target = observation.target;
  const key = deviceKey(target);

  if (observation.exists === false) {
    if (next.devices[key]) {
      next = applyPatch(next, {op: "REMOVE_DEVICE", target, turn_id: turnId}).runtime;
    }
    return next;
  }

  const existing = next.devices[key];
  if (!existing) {
    next = applyPatch(next, {
      op: "ADD_DEVICE",
      target,
      slots: clone(observation.slots || {}),
      turn_id: turnId
    }).runtime;
    return next;
  }

  for (const [slot, value] of Object.entries(observation.slots || {})) {
    if (JSON.stringify(existing.slots && existing.slots[slot]) === JSON.stringify(value)) continue;
    next = applyPatch(next, {op: "PATCH_SLOT", target, slot, value: clone(value), turn_id: turnId}).runtime;
  }
  return next;
}

async function executeSinglePhysicalPatch(inputRuntime, expanded, driver, options = {}) {
  let runtime = normalizeRuntime(inputRuntime);
  const physicalPatch = materializePatch(runtime, expanded);
  const turnId=expanded.turn_id || options.turn_id || null;

  if(
    physicalPatch.target &&
    isQuarantined(runtime,physicalPatch.target) &&
    !isSafetyReducingPatch(runtime,physicalPatch)
  ){
    const observation={
      target:clone(physicalPatch.target),
      exists:!!activeDevice(runtime,physicalPatch.target),
      slots:clone(activeDevice(runtime,physicalPatch.target)?.slots||{}),
      evidence:{source:"runtime:quarantine",measured:false}
    };
    const id="quarantine:"+String(runtime.executionLedger.length+1);
    runtime.executionLedger.push({
      id,turn_id:turnId,kind:"physical",status:"blocked",reason:"device_quarantined",
      semantic_patch:clone(expanded),physical_patch:clone(physicalPatch),observation:clone(observation)
    });
    return {ok:false,runtime,receipts:[{
      patch:clone(expanded),physical_patch:clone(physicalPatch),command_id:id,
      status:"blocked",reason:"device_quarantined",observation:clone(observation)
    }],reason:"device_quarantined"};
  }

  const command = await Promise.resolve(driver.execute(physicalPatch));
  if (!command || typeof command !== "object") throw new Error("physical_driver_invalid_receipt");
  if (!command.observation) throw new Error("physical_driver_missing_observation");

  const expectedTarget=expectedObservationTarget(physicalPatch);
  const observedTarget=command.observation&&command.observation.target||null;
  if(
    expectedTarget&&(
      !observedTarget||
      deviceKey(observedTarget)!==deviceKey(expectedTarget)
    )
  ){
    const unsafeCommand={
      ...clone(command),
      status:"unsafe",
      reason:"physical_receipt_target_mismatch"
    };
    markQuarantined(runtime,expectedTarget,unsafeCommand,turnId);
    const executionRecord={
      id:command.id || "physical:"+String(runtime.executionLedger.length+1),
      turn_id:turnId,
      kind:"physical",
      status:"unsafe",
      reason:"physical_receipt_target_mismatch",
      semantic_patch:clone(expanded),
      physical_patch:clone(physicalPatch),
      observation:clone(command.observation)
    };
    runtime.executionLedger.push(executionRecord);
    return {
      ok:false,
      runtime,
      receipts:[{
        patch:clone(expanded),
        physical_patch:clone(physicalPatch),
        command_id:executionRecord.id,
        status:"unsafe",
        reason:"physical_receipt_target_mismatch",
        expected_target:clone(expectedTarget),
        observation:clone(command.observation),
        driver_receipt:clone(command)
      }],
      reason:"physical_receipt_target_mismatch"
    };
  }

  runtime = reconcileObservation(runtime, command.observation, turnId);
  if(physicalPatch.target && ["uncertain","unsafe"].includes(command.status)){
    markQuarantined(runtime,physicalPatch.target,command,turnId);
  }
  const executionRecord={
    id:command.id || "physical:"+String(runtime.executionLedger.length+1),
    turn_id:turnId,kind:"physical",status:command.status || "unknown",
    reason:command.reason || null,semantic_patch:clone(expanded),
    physical_patch:clone(physicalPatch),observation:clone(command.observation)
  };
  runtime.executionLedger.push(executionRecord);
  return {ok:true,runtime,receipts:[{
    patch:clone(expanded),physical_patch:clone(physicalPatch),
    command_id:executionRecord.id,status:executionRecord.status,reason:executionRecord.reason,
    observation:clone(command.observation),driver_receipt:clone(command),
    ack:clone(command.ack||null),polls:command.polls==null?null:command.polls,
    requested_position_pct:command.requested_position_pct==null?null:command.requested_position_pct,
    before_tick:command.before_tick==null?null:command.before_tick,
    hardware_identity_before:command.hardware_identity_before||null,
    hardware_identity_after:command.hardware_identity_after||null,
    readiness_before:clone(command.readiness_before||command.readiness||null),
    readiness_after:clone(command.readiness_after||null),
    safety_stop:clone(command.safety_stop||null)
  }],reason:null};
}

async function executePhysicalTurn(inputRuntime, patches, driver, options = {}) {
  let runtime=normalizeRuntime(inputRuntime);
  const receipts=[];
  const {executePhysicalTransaction}=require("./physical_transaction_router.cjs");
  for(const proposed of patches || []){
    const expanded=expandSetPatch(proposed);
    if(expanded.every(p=>["CANCEL_PENDING","PROTECT"].includes(p.op))){
      for(const localPatch of expanded){
        const local=applyPatch(runtime,localPatch);
        runtime=local.runtime;
        receipts.push({patch:clone(localPatch),local_only:true,receipt:local.receipt});
      }
      continue;
    }
    const result=await executePhysicalTransaction(runtime,proposed,driver,options,executeSinglePhysicalPatch);
    if(!result.ok) return {runtime:result.runtime,receipts:result.receipts,ok:false,reason:result.reason};
    runtime=result.runtime;
    receipts.push(...result.receipts);
  }
  return {runtime,receipts,ok:true,reason:null};
}

module.exports = {
  MockThingDriver,
  materializePatch,
  expectedObservationTarget,
  reconcileObservation,
  deviceHealth,
  isQuarantined,
  isSafetyReducingPatch,
  markQuarantined,
  clearQuarantine,
  evaluateQuarantinePreflight,
  executeSinglePhysicalPatch,
  executePhysicalTurn
};
