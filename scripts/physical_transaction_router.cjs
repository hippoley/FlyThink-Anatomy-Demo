"use strict";

/**
 * Production transaction router.
 * Multi-target semantic SETs must remain grouped until the physical boundary.
 * They may never degrade to sequential driver.execute() calls.
 */
const {expandSetPatch}=require("./whole_home_patch_contract.cjs");
const {executeAtomicPhysicalSet}=require("./atomic_physical_set.cjs");

async function executePhysicalTransaction(inputRuntime,proposed,driver,options={},singleExecutor){
  const expanded=expandSetPatch(proposed);
  if(Array.isArray(proposed&&proposed.targets)&&expanded.length>1){
    return executeAtomicPhysicalSet(inputRuntime,expanded,driver,options);
  }
  if(typeof singleExecutor!=="function")
    throw new Error("single_physical_executor_required");
  return singleExecutor(inputRuntime,expanded[0],driver,options);
}

module.exports={executePhysicalTransaction};
