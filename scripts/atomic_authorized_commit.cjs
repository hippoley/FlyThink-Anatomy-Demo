"use strict";
const crypto=require("crypto");
const {applyTurn,normalizeRuntime,deviceKey}=require("./whole_home_patch_contract.cjs");

function patchTargets(p){if(Array.isArray(p.targets))return p.targets;if(p.target)return [p.target];return [];}
function targetKey(t){return typeof t==="string"?t:deviceKey(t);}
function canonicalValue(v){
  if(typeof v==="number"){
    if(!Number.isFinite(v))throw new Error("non_finite_authorization_value");
    if(Object.is(v,-0))return 0;
    if(Number.isInteger(v)&&!Number.isSafeInteger(v))throw new Error("unsafe_authorization_number");
    return v;
  }
  if(Array.isArray(v))return v.map(canonicalValue);
  if(v&&typeof v==="object")
    return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,canonicalValue(x)]));
  return v;
}
function f64hex(v){
  const b=Buffer.allocUnsafe(8);
  b.writeDoubleBE(v===0?0:v,0);
  return b.toString("hex");
}
function canonicalEncode(value){
  value=canonicalValue(value);
  if(value===null)return "z";
  if(typeof value==="boolean")return value?"b1":"b0";
  if(typeof value==="number")return "n"+f64hex(value);
  if(typeof value==="string")return "s"+JSON.stringify(value);
  if(Array.isArray(value))return "a["+value.map(canonicalEncode).join(",")+"]";
  if(value&&typeof value==="object")
    return "o{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonicalEncode(value[k])).join(",")+"}";
  throw new Error("unsupported_authorization_value");
}

function canonicalPatch(p){
  return {capability:p.capability,model_id:p.model_id,slot:p.slot,target:targetKey(p.target),value:canonicalValue(p.value)};
}
function authorizationDigest(patches){
  return crypto.createHash("sha256").update(canonicalEncode((patches||[]).map(canonicalPatch)),"utf8").digest("hex");
}
function semanticPatch(p){
  const [area,entity,instance]=targetKey(p.target).split("::");
  return {op:"PATCH_SLOT",target:{area,entity,instance},slot:p.slot,value:p.value};
}
function assertLedger(ledger){
  if(!ledger||typeof ledger.reserve!=="function"||typeof ledger.consume!=="function"||typeof ledger.release!=="function")
    throw new Error("authorization_ledger_required");
}
function atomicApplyAuthorizedPlan(inputRuntime,plannerResult,currentRegistryDigest,authorizationLedger){
  const before=normalizeRuntime(inputRuntime);
  let reservedId=null;
  try{
    assertLedger(authorizationLedger);
    if(typeof currentRegistryDigest!=="string"||!currentRegistryDigest)
      throw new Error("current_registry_digest_required");
    if(!plannerResult||plannerResult.ok!==true)throw new Error("planner_result_not_authorized");
    const auth=plannerResult.authorization;
    if(!auth||auth.version!==2||!auth.authorization_id||!auth.patch_digest||!auth.registry_digest)
      throw new Error("planner_authorization_missing");
    if(currentRegistryDigest!==auth.registry_digest)throw new Error("planner_authorization_stale_registry");
    const patches=plannerResult.patches||[];
    if(authorizationDigest(patches)!==auth.patch_digest)throw new Error("planner_authorization_digest_mismatch");
    for(const p of patches)for(const t of patchTargets(p)){
      const k=targetKey(t);
      if(!before.devices[k])throw new Error("authorized_target_not_mounted:"+k);
    }

    const reserved=authorizationLedger.reserve(auth.authorization_id,{
      turn_id:auth.turn_id||null,
      patch_digest:auth.patch_digest,
      registry_digest:auth.registry_digest
    });
    if(!reserved)throw new Error("planner_authorization_replayed");
    reservedId=auth.authorization_id;

    let out;
    try{
      out=applyTurn(before,patches.map(semanticPatch));
    }catch(e){
      authorizationLedger.release(reservedId,"state_commit_failed");
      reservedId=null;
      throw e;
    }

    const consumed=authorizationLedger.consume(reservedId,{state_commit:true});
    if(!consumed)
      return {ok:false,runtime:before,receipts:[],reason:"authorization_commit_indeterminate"};
    reservedId=null;
    return {ok:true,runtime:out.runtime,receipts:out.receipts,reason:null};
  }catch(e){
    return {ok:false,runtime:before,receipts:[],reason:String(e.message||e)};
  }
}

// Compatibility-only unsafe boundary. Production planner-bound execution must use atomicApplyAuthorizedPlan.
function atomicApplyAuthorizedTurn(inputRuntime,patches,authorizedTargetKeys){
  const before=normalizeRuntime(inputRuntime),allowed=new Set(authorizedTargetKeys||[]);
  try{
    for(const p of patches||[])for(const t of patchTargets(p)){
      const k=deviceKey(t);
      if(!allowed.has(k))throw new Error("target_not_authorized:"+k);
      if(!before.devices[k])throw new Error("authorized_target_not_mounted:"+k);
    }
    const out=applyTurn(before,patches);
    return {ok:true,runtime:out.runtime,receipts:out.receipts,reason:null};
  }catch(e){return {ok:false,runtime:before,receipts:[],reason:String(e.message||e)};}
}
module.exports={atomicApplyAuthorizedTurn,atomicApplyAuthorizedPlan,authorizationDigest};
