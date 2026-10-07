"use strict";

/**
 * FlyThink adapter for the canonical Contextual Edge SLU state contract.
 *
 * Canonical semantic/task ownership lives in hippoley/NLUSLOT.
 * FlyThink may expose its internal execution/world state through this adapter,
 * but callers must not depend on FlyThink's private runtime shape directly.
 */
const crypto=require("crypto");
const {deriveContext}=require("./runtime_context_adapter.cjs");
const {deviceKey}=require("./whole_home_patch_contract.cjs");

const CONTRACT_VERSION="contextual-state.v1";
const CONTEXT_CANONICALIZATION="sorted-json-number-normalized-v1";
const SAFE_RECOVERY_ACTIONS=[
  "READ","STOP","CLOSE","POWER_OFF","REDUCE_OPENING","RECOVERY"
];

function clone(x){return x==null?x:JSON.parse(JSON.stringify(x));}
function canonicalContextValue(value){
  if(Array.isArray(value))return value.map(canonicalContextValue);
  if(value&&typeof value==="object"){
    const out={};
    for(const key of Object.keys(value).sort()){
      out[key]=canonicalContextValue(value[key]);
    }
    return out;
  }
  if(typeof value==="number"&&!Number.isFinite(value)){
    throw new Error("context_state_non_finite_number");
  }
  return value;
}
function contextStateDigest(snapshot){
  if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot)){
    throw new Error("context_state_not_object");
  }
  const body={...snapshot};
  delete body.context_sha256;
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalContextValue(body)))
    .digest("hex");
}

function logicalTarget(target){
  if(!target||!target.area||!target.entity) return null;
  return {
    area:String(target.area),
    entity:String(target.entity),
    instance:String(target.instance||"default")
  };
}

function deriveSemanticContext(runtime,history=[]){
  return deriveContext(runtime,history);
}

function toContextStateSnapshot(runtime,history=[],meta={}){
  const context=deriveContext(runtime,history);
  const hasContextRevision=Object.prototype.hasOwnProperty.call(meta,"context_revision");
  if(
    hasContextRevision&&(
      !Number.isInteger(meta.context_revision)||
      meta.context_revision<0
    )
  ){
    throw new Error("context_state_revision_invalid");
  }
  const devices={};
  for(const [key,device] of Object.entries((runtime&&runtime.devices)||{})){
    const target=logicalTarget(device&&device.area?device:{
      area:key.split("::")[0],
      entity:key.split("::")[1],
      instance:key.split("::")[2]||"default"
    });
    if(!target) continue;
    devices[key]={
      target,
      model_id:device&&device.model_id||null,
      slots:clone(device&&device.slots||{}),
      observed_at:device&&device.observed_at||null,
      source:device&&device.source||null
    };
  }

  const health={};
  for(const [key,item] of Object.entries((runtime&&runtime.deviceHealth)||{})){
    health[key]={
      status:item&&item.status||"unknown",
      reason:item&&item.reason||null,
      since_turn_id:item&&item.since_turn_id||null,
      allowed_actions:
        item&&item.status==="quarantined"
          ? SAFE_RECOVERY_ACTIONS.slice()
          : []
    };
  }

  return {
    contract_version:CONTRACT_VERSION,
    ...(hasContextRevision?{context_revision:meta.context_revision}:{}),
    conversation:{
      conversation_id:meta.conversation_id||null,
      active_task_id:meta.active_task_id||null,
      pending_task_id:meta.pending_task_id||null,
      focused_target:logicalTarget(context.focused_target),
      referent_set:(context.referent_set||[]).map(logicalTarget).filter(Boolean)
    },
    tasks:Array.isArray(meta.tasks)?clone(meta.tasks):[],
    world:{devices},
    execution:{
      device_health:health,
      pending_ids:(context.pending_ids||[]).slice(),
      last_execution:clone(context.last_execution||null)
    }
  };
}

function contextStateIdentity(snapshot){
  assertContextStateSnapshot(snapshot);
  if(
    !Number.isInteger(snapshot.context_revision)||
    snapshot.context_revision<0
  ){
    throw new Error("context_state_revision_required");
  }
  if(snapshot.context_canonicalization!==CONTEXT_CANONICALIZATION){
    throw new Error("context_state_canonicalization_required");
  }
  if(!/^[0-9a-f]{64}$/.test(String(snapshot.context_sha256||""))){
    throw new Error("context_state_sha256_required");
  }
  const expected=contextStateDigest(snapshot);
  if(expected!==snapshot.context_sha256){
    throw new Error("context_state_sha256_mismatch");
  }
  return {
    contract_version:snapshot.contract_version,
    context_revision:snapshot.context_revision,
    context_canonicalization:snapshot.context_canonicalization,
    context_sha256:snapshot.context_sha256
  };
}

function assertContextStateSnapshot(snapshot){
  if(!snapshot||snapshot.contract_version!==CONTRACT_VERSION)
    throw new Error("unsupported_context_state_contract");
  for(const key of ["conversation","tasks","world","execution"])
    if(!(key in snapshot))throw new Error("missing_context_state_section:"+key);
  const targets=[
    snapshot.conversation.focused_target,
    ...(snapshot.conversation.referent_set||[]),
    ...Object.values(snapshot.world.devices||{}).map(x=>x&&x.target)
  ].filter(Boolean);
  for(const target of targets){
    const keys=Object.keys(target).sort().join(",");
    if(keys!=="area,entity,instance")
      throw new Error("logical_target_contract_violation");
    if(!target.area||!target.entity||!target.instance)
      throw new Error("logical_target_contract_violation");
  }
  return true;
}

module.exports={
  CONTRACT_VERSION,
  CONTEXT_CANONICALIZATION,
  SAFE_RECOVERY_ACTIONS,
  logicalTarget,
  deriveSemanticContext,
  toContextStateSnapshot,
  contextStateDigest,
  contextStateIdentity,
  assertContextStateSnapshot,
  deviceKey
};
