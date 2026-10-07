"use strict";
const crypto=require("crypto");
const {applyTurn,normalizeRuntime,deviceKey}=require("./whole_home_patch_contract.cjs");

function patchTargets(p){
 if(Array.isArray(p.targets))return p.targets;
 if(p.target)return [p.target];
 return [];
}
function targetKey(t){return typeof t==="string"?t:deviceKey(t);}
function canonicalPatch(p){
 return {capability:p.capability,model_id:p.model_id,slot:p.slot,target:targetKey(p.target),value:p.value};
}
function stable(value){
 if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";
 if(value&&typeof value==="object"){
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";
 }
 return JSON.stringify(value);
}
function authorizationDigest(patches){
 return crypto.createHash("sha256").update(stable((patches||[]).map(canonicalPatch)),"utf8").digest("hex");
}
function semanticPatch(p){
 const [area,entity,instance]=targetKey(p.target).split("::");
 return {op:"PATCH_SLOT",target:{area,entity,instance},slot:p.slot,value:p.value};
}
function atomicApplyAuthorizedPlan(inputRuntime,plannerResult,currentRegistryDigest=null,consumedAuthorizationIds=null){
 const before=normalizeRuntime(inputRuntime);
 try{
  if(!plannerResult||plannerResult.ok!==true)throw new Error("planner_result_not_authorized");
  const auth=plannerResult.authorization;
  if(!auth||auth.version!==1||!auth.authorization_id||!auth.patch_digest||!auth.registry_digest)throw new Error("planner_authorization_missing");
  if(consumedAuthorizationIds&&consumedAuthorizationIds.has(auth.authorization_id))
   throw new Error("planner_authorization_replayed");
  if(currentRegistryDigest!==null&&currentRegistryDigest!==auth.registry_digest)
   throw new Error("planner_authorization_stale_registry");
  const patches=plannerResult.patches||[];
  if(authorizationDigest(patches)!==auth.patch_digest)throw new Error("planner_authorization_digest_mismatch");
  for(const p of patches){
   for(const t of patchTargets(p)){
    const k=targetKey(t);
    if(!before.devices[k])throw new Error("authorized_target_not_mounted:"+k);
   }
  }
  const out=applyTurn(before,patches.map(semanticPatch));
  return {ok:true,runtime:out.runtime,receipts:out.receipts,reason:null};
 }catch(e){return {ok:false,runtime:before,receipts:[],reason:String(e.message||e)};}
}

// Legacy boundary retained only for compatibility; new callers should use planner-bound envelope.
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
