"use strict";
/** Instrumented patch execution for CommitBench.
 *
 * Records every intermediate runtime mutation. This is evaluation instrumentation:
 * it does not change the semantic model, patch contract, or execution policy.
 */
const {normalizeRuntime, applyPatch, expandSetPatch, diffLeaves}=require("./whole_home_patch_contract.cjs");

function clone(x){return x==null?x:JSON.parse(JSON.stringify(x));}

function deviceSlotPaths(beforeRuntime, afterRuntime){
  const changed=diffLeaves((beforeRuntime||{}).devices||{},(afterRuntime||{}).devices||{});
  return changed.map(p=>"devices."+p.replaceAll("::","::"));
}

function runInstrumentedTurn(inputRuntime, patches){
  let runtime=normalizeRuntime(inputRuntime);
  const states=[clone(runtime)];
  const steps=[];
  let index=0;
  for(const proposed of patches||[]){
    for(const patch of expandSetPatch(proposed)){
      const before=clone(runtime);
      const result=applyPatch(runtime,patch);
      runtime=result.runtime;
      const after=clone(runtime);
      steps.push({
        index:index++,
        patch:clone(patch),
        changed_paths:deviceSlotPaths(before,after),
        before,
        after
      });
      states.push(after);
    }
  }
  return {runtime,states,steps};
}

module.exports={runInstrumentedTurn};
