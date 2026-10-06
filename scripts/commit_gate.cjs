"use strict";

/**
 * Commit gate between semantic hypotheses and state/physical mutation.
 *
 * Understanding is allowed to be speculative. State mutation is not.
 * Batch turns default to safe_to_commit; streaming callers must surface an
 * explicit commit_state for partial hypotheses.
 *
 * Revision-aware callers use optimistic concurrency: a proposal produced
 * from an older world-state revision must never reach state/physical mutation.
 */
const SAFE=new Set(["safe_to_commit","final","committed","stable"]);
const STREAMING_SAFE=new Set(["safe_to_commit","final","committed"]);
const DEFER=new Set(["unstable","partial","tentative","streaming","hypothesis","stable"]);

function evaluateCommit({
  decision,patches,commit_state,mode="batch",base_revision,current_revision
}={}){
  if(decision!=="EXECUTE"){
    return {allow:false,deferred:false,reason:"decision_not_execute",commit_state:commit_state||null};
  }
  if(!Array.isArray(patches)||patches.length===0){
    return {allow:false,deferred:false,reason:"no_executable_patch",commit_state:commit_state||null};
  }
  const state=commit_state||"safe_to_commit";
  const meta=mode==="streaming"?{mode}:{};

  // Preserve legacy callers, but enforce compare-and-swap semantics whenever
  // both revision values are present.
  if(base_revision!=null && current_revision!=null && base_revision!==current_revision){
    return {
      allow:false,deferred:false,reason:"stale_base_revision",commit_state:state,
      base_revision,current_revision,...meta
    };
  }

  const safe=mode==="streaming"?STREAMING_SAFE:SAFE;
  if(safe.has(state))return {allow:true,deferred:false,reason:"safe_to_commit",commit_state:state,...meta};
  if(DEFER.has(state))return {allow:false,deferred:true,reason:"semantic_hypothesis_not_committed",commit_state:state,...meta};
  return {allow:false,deferred:true,reason:"unknown_commit_state",commit_state:state,...meta};
}

module.exports={evaluateCommit,SAFE,STREAMING_SAFE,DEFER};
