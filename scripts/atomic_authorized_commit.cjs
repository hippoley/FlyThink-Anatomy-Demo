"use strict";
/** Atomic physical commit boundary. Requires planner-validated target allowlist. */
const {applyTurn,normalizeRuntime,deviceKey}=require("./whole_home_patch_contract.cjs");
function patchTargets(p){
 if(Array.isArray(p.targets))return p.targets;
 if(p.target)return [p.target];
 return [];
}
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
module.exports={atomicApplyAuthorizedTurn};
