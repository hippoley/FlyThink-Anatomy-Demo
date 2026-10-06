"use strict";

function applyCanaryDecision({
  registry,
  canary_evaluation,
  actor,
  evidence_ref=null
}={}){
  if(!registry||typeof registry.rollback!=="function")throw new Error("policy_registry_required");
  if(!canary_evaluation||canary_evaluation.schema_version!=="pi-home-canary-evaluation-v1"){
    throw new Error("canary_evaluation_required");
  }

  if(canary_evaluation.decision!=="ABORT_AND_ROLLBACK"){
    return {
      changed:false,
      action:"NO_ROLLBACK",
      reason:"canary_did_not_request_rollback",
      canary_decision:canary_evaluation.decision,
      active_policy_id:registry.active()&&registry.active().id||null,
      device_execution_authorized:false
    };
  }

  if(canary_evaluation.rollback_recommended!==true){
    throw new Error("canary_abort_without_rollback_recommendation");
  }
  if(typeof actor!=="string"||!actor.trim())throw new Error("rollback_actor_required");

  const result=registry.rollback({
    actor:actor.trim(),
    reason:"canary safety invariant failed",
    evidence_ref
  });
  return {
    changed:true,
    action:"ROLLED_BACK",
    reason:"canary_abort_applied",
    canary_decision:canary_evaluation.decision,
    rollback:result,
    active_policy_id:result.active_policy_id,
    device_execution_authorized:false
  };
}

module.exports={applyCanaryDecision};
