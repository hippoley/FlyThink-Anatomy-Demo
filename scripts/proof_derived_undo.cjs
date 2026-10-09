"use strict";

const {deviceKey,normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {verifyExecutionProofBundle}=require("./execution_proof_bundle.cjs");
const {digestObject}=require("./execution_receipt.cjs");
const {
  evaluateQuarantinePreflight,
  executePhysicalTurn
}=require("./physical_runtime.cjs");
const {validateAuthorizationResult}=require("./flythink_execution_runtime.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}

function deriveProofUndoPlan(bundle,currentRuntime){
  const verified=verifyExecutionProofBundle(bundle);
  if(verified.physical_committed!==true||verified.physical_truth_verified!==true)
    throw new Error("undo_proof_physical_truth_required");

  const a=bundle.artifacts||{};
  const receipt=a.execution_receipt||{};
  const actions=receipt.authorization&&receipt.authorization.authorized_actions||[];
  const evidence=receipt.physical&&receipt.physical.evidence||[];
  if(actions.length!==1||evidence.length!==1)
    throw new Error("undo_proof_single_action_required");

  const action=actions[0],row=evidence[0];
  if(!row||row.status!=="applied"||typeof row.command_id!=="string"||!row.command_id)
    throw new Error("undo_proof_applied_command_required");
  if(!["PATCH_SLOT","PATCH_RELATIVE","CLOSE_DEVICE"].includes(action.op))
    throw new Error("undo_proof_action_not_safely_reversible");

  const target=clone(action.target);
  const slot=action.op==="CLOSE_DEVICE"?(action.slot||"power"):action.slot;
  if(!target||!slot)throw new Error("undo_proof_slot_identity_required");

  const key=deviceKey(target);
  const before=a.before_runtime&&a.before_runtime.devices&&a.before_runtime.devices[key];
  const after=a.after_runtime&&a.after_runtime.devices&&a.after_runtime.devices[key];
  if(!before||!after)throw new Error("undo_proof_runtime_target_missing");
  if(!Object.prototype.hasOwnProperty.call(before.slots||{},slot))
    throw new Error("undo_proof_before_value_missing");
  if(!Object.prototype.hasOwnProperty.call(after.slots||{},slot))
    throw new Error("undo_proof_after_value_missing");
  const beforeValue=clone(before.slots[slot]);
  const afterValue=clone(after.slots[slot]);
  if(same(beforeValue,afterValue))throw new Error("undo_proof_no_effect_to_reverse");

  const current=normalizeRuntime(currentRuntime||{});
  const currentDevice=current.devices[key];
  if(!currentDevice||!Object.prototype.hasOwnProperty.call(currentDevice.slots||{},slot))
    throw new Error("undo_current_state_missing");
  if(!same(currentDevice.slots[slot],afterValue))
    throw new Error("undo_current_state_diverged");
  if(!current.executionLedger.some(
    x=>x&&x.id===row.command_id&&x.kind==="physical"&&x.status==="applied"
  ))throw new Error("undo_current_execution_evidence_missing");

  return {
    execution_id:row.command_id,
    compensation:{op:"PATCH_SLOT",target,slot,value:beforeValue},
    expected_current_value:afterValue,
    proof_basis:{
      bundle_sha256:bundle.bundle_sha256,
      execution_receipt_sha256:verified.execution_receipt_sha256,
      before_runtime_sha256:bundle.manifest.before_runtime_sha256,
      after_runtime_sha256:bundle.manifest.after_runtime_sha256,
      authorized_action_sha256:digestObject(action)
    }
  };
}

async function runProofDerivedUndo({
  runtime,proof_bundle,driver,physicalAuthorizer,authorizationLedger,
  authorization_context={},source_step=0,source_revision=null,
  expected_spatialruntime_commit_sha=null
}={}){
  const current=normalizeRuntime(runtime||{});
  const plan=deriveProofUndoPlan(proof_bundle,current);
  if(!driver||typeof driver!=="object")throw new Error("undo_physical_driver_required");
  if(typeof physicalAuthorizer!=="function")throw new Error("undo_physical_authorizer_required");
  if(!authorizationLedger||typeof authorizationLedger.add!=="function")
    throw new Error("undo_authorization_ledger_required");

  const requested=[clone(plan.compensation)];
  const preflight=evaluateQuarantinePreflight(current,requested);
  if(!preflight.allow)return {
    ok:false,status:"BLOCKED",reason:"device_quarantined",
    runtime:current,plan,authorization:null,physical_receipts:[]
  };

  const revision=source_revision==null
    ?(Array.isArray(current.revisions)?current.revisions.length:0)
    :Number(source_revision);
  const taskId="undo:"+plan.execution_id;
  const context={...clone(authorization_context),proof_derived_undo:clone(plan.proof_basis)};
  const raw=await physicalAuthorizer({
    runtime:clone(current),patches:clone(requested),event:{turn_id:taskId},
    context,source_step,source_revision:revision
  });
  const auth=validateAuthorizationResult(raw,requested,{
    task_id:taskId,source_step,source_revision:revision,runtime:current,
    authorization_context:context,expected_spatialruntime_commit_sha
  });
  if(digestObject(auth.patches)!==digestObject(requested))
    throw new Error("undo_authorization_changed_derived_compensation");

  const receipt=auth.receipt;
  if(authorizationLedger.add(receipt.authorization_id,{
    task_id:taskId,receipt_sha256:receipt.receipt_sha256||null,
    patch_digest:receipt.patch_digest,registry_digest:receipt.registry_digest
  })===false)throw new Error("undo_physical_authorization_replayed");

  const physical=await executePhysicalTurn(current,[{
    op:"UNDO_EXECUTED",
    execution_id:plan.execution_id,
    compensation:clone(plan.compensation),
    proof_basis:clone(plan.proof_basis),
    authorization_id:receipt.authorization_id
  }],driver,{turn_id:taskId});

  return {
    ok:physical.ok===true,
    status:physical.ok===true?"COMPENSATED":"PHYSICAL_NOT_COMMITTED",
    reason:physical.ok===true?null:physical.reason,
    runtime:physical.runtime,
    plan,
    authorization:clone(receipt),
    physical_receipts:clone(physical.receipts||[])
  };
}

module.exports={deriveProofUndoPlan,runProofDerivedUndo};
