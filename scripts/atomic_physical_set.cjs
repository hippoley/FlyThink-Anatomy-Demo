"use strict";

const {normalizeRuntime,deviceKey}=require("./whole_home_patch_contract.cjs");
const {
  materializePatch,
  expectedObservationTarget,
  reconcileObservation
}=require("./physical_runtime.cjs");
const {PHYSICAL_CAPABILITIES,requireCapability}=require("./physical_driver_capabilities.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}

async function executeAtomicPhysicalSet(inputRuntime,patches,driver,options={}){
  const before=normalizeRuntime(inputRuntime);
  if(!Array.isArray(patches)||patches.length===0)
    return {ok:true,runtime:before,receipts:[],reason:null};

  const atomic=requireCapability(driver,PHYSICAL_CAPABILITIES.ATOMIC_MULTI_TARGET_SET);
  if(!atomic.ok) return {ok:false,runtime:before,receipts:[],reason:atomic.reason};
  const readback=requireCapability(driver,PHYSICAL_CAPABILITIES.READBACK);
  if(!readback.ok) return {ok:false,runtime:before,receipts:[],reason:readback.reason};
  if(typeof driver.executeAtomicBatch!=="function")
    return {ok:false,runtime:before,receipts:[],reason:"physical_atomic_batch_missing_implementation"};

  const physical=[];
  try{
    for(const patch of patches) physical.push(materializePatch(before,patch));
  }catch(e){
    return {ok:false,runtime:before,receipts:[],reason:String(e.message||e)};
  }

  let commands;
  try{commands=await Promise.resolve(driver.executeAtomicBatch(clone(physical)));}
  catch(e){
    return {ok:false,runtime:before,receipts:[],reason:"physical_atomic_batch_failed:"+String(e.message||e)};
  }
  if(!Array.isArray(commands)||commands.length!==physical.length)
    return {ok:false,runtime:before,receipts:[],reason:"physical_atomic_batch_invalid_receipts"};
  if(commands.some(c=>!c||c.status!=="applied"||!c.observation))
    return {ok:false,runtime:before,receipts:[],reason:"physical_atomic_batch_not_committed"};

  for(let i=0;i<commands.length;i++){
    const expected=expectedObservationTarget(physical[i]);
    const observed=commands[i].observation&&commands[i].observation.target||null;
    if(expected&&(!observed||deviceKey(expected)!==deviceKey(observed))){
      return {
        ok:false,
        runtime:before,
        receipts:[],
        reason:"physical_atomic_batch_receipt_target_mismatch:"+String(i)
      };
    }
  }

  let runtime=before;
  const receipts=[];
  for(let i=0;i<commands.length;i++){
    const command=commands[i],semantic=patches[i];
    const turnId=semantic.turn_id||options.turn_id||null;
    runtime=reconcileObservation(runtime,command.observation,turnId);
    const record={
      id:command.id||"physical-batch:"+String(i+1),
      turn_id:turnId,kind:"physical",status:"applied",reason:null,
      semantic_patch:clone(semantic),physical_patch:clone(physical[i]),
      observation:clone(command.observation),atomic_batch:true
    };
    runtime.executionLedger.push(record);
    receipts.push({
      patch:clone(semantic),physical_patch:clone(physical[i]),
      command_id:record.id,status:"applied",reason:null,
      observation:clone(command.observation),atomic_batch:true
    });
  }
  return {ok:true,runtime,receipts,reason:null};
}

module.exports={executeAtomicPhysicalSet};
