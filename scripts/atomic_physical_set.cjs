"use strict";

/**
 * Physical SET boundary.
 *
 * State-level atomicity is not enough for real devices: sequential driver.execute()
 * can move device A before device B rejects. Multi-target SET therefore requires
 * an explicit driver batch primitive. Drivers without that capability fail closed.
 */
const {normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {materializePatch,reconcileObservation}=require("./physical_runtime.cjs");\nconst {PHYSICAL_CAPABILITIES,requireCapability}=require("./physical_driver_capabilities.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}

async function executeAtomicPhysicalSet(inputRuntime, patches, driver, options={}){
  const before=normalizeRuntime(inputRuntime);
  if(!Array.isArray(patches)||patches.length===0)
    return {ok:true,runtime:before,receipts:[],reason:null};
  if(!driver||typeof driver.executeAtomicBatch!=="function")
    return {ok:false,runtime:before,receipts:[],reason:"physical_atomic_batch_unsupported"};

  const physical=[];
  try{
    for(const patch of patches) physical.push(materializePatch(before,patch));
  }catch(e){
    return {ok:false,runtime:before,receipts:[],reason:String(e.message||e)};
  }

  let commands;
  try{commands=await Promise.resolve(driver.executeAtomicBatch(clone(physical)));}
  catch(e){return {ok:false,runtime:before,receipts:[],reason:"physical_atomic_batch_failed:"+String(e.message||e)};}

  if(!Array.isArray(commands)||commands.length!==physical.length)
    return {ok:false,runtime:before,receipts:[],reason:"physical_atomic_batch_invalid_receipts"};
  if(commands.some(c=>!c||c.status!=="applied"||!c.observation))
    return {ok:false,runtime:before,receipts:[],reason:"physical_atomic_batch_not_committed"};

  let runtime=before;
  const receipts=[];
  for(let i=0;i<commands.length;i++){
    const command=commands[i], semantic=patches[i];
    const turnId=semantic.turn_id||options.turn_id||null;
    runtime=reconcileObservation(runtime,command.observation,turnId);
    const record={
      id:command.id||"physical-batch:"+String(i+1),turn_id:turnId,kind:"physical",
      status:"applied",reason:null,semantic_patch:clone(semantic),
      physical_patch:clone(physical[i]),observation:clone(command.observation),
      atomic_batch:true
    };
    runtime.executionLedger.push(record);
    receipts.push({patch:clone(semantic),physical_patch:clone(physical[i]),
      command_id:record.id,status:"applied",reason:null,
      observation:clone(command.observation),atomic_batch:true});
  }
  return {ok:true,runtime,receipts,reason:null};
}

module.exports={executeAtomicPhysicalSet};
