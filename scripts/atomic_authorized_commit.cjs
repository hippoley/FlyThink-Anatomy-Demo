"use strict";
/** Atomic commit boundary for already-authorized minimal patches. */
const {applyTurn,normalizeRuntime}=require("./whole_home_patch_contract.cjs");
function atomicApplyAuthorizedTurn(inputRuntime,patches){
 const before=normalizeRuntime(inputRuntime);
 try{
  // applyTurn works on clones; no state escapes unless every patch succeeds.
  const out=applyTurn(before,patches);
  return {ok:true,runtime:out.runtime,receipts:out.receipts,reason:null};
 }catch(e){
  return {ok:false,runtime:before,receipts:[],reason:String(e.message||e)};
 }
}
module.exports={atomicApplyAuthorizedTurn};
