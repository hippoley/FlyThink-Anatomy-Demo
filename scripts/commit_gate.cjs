"use strict";

/**
 * Commit gate between semantic hypotheses and state/physical mutation.
 *
 * Understanding is allowed to be speculative. State mutation is not.
 * Batch turns default to safe_to_commit; streaming callers must surface an
 * explicit commit_state for partial hypotheses.
 */
const SAFE=new Set(["safe_to_commit","final","committed","stable"]);
const STREAMING_SAFE=new Set(["safe_to_commit","final","committed"]);
const DEFER=new Set(["unstable","partial","tentative","streaming","hypothesis","stable"]);

function evaluateCommit({decision,patches,commit_state,mode="batch"}={}){
  if(decision!=="EXECUTE"){
    return {allow:false,deferred:false,reason:"decision_not_execute",commit_state:commit_state||null};
  }
  if(!Array.isArray(patches)||patches.length===0){
    return {allow:false,deferred:false,reason:"no_executable_patch",commit_state:commit_state||null};
  }
  const state=commit_state||"safe_to_commit";
  const safe=mode==="streaming"?STREAMING_SAFE:SAFE;
  if(safe.has(state))return {allow:true,deferred:false,reason:"safe_to_commit",commit_state:state,mode};
  if(DEFER.has(state))return {allow:false,deferred:true,reason:"semantic_hypothesis_not_committed",commit_state:state,mode};
  return {allow:false,deferred:true,reason:"unknown_commit_state",commit_state:state,mode};
}

module.exports={evaluateCommit,SAFE,STREAMING_SAFE,DEFER};
