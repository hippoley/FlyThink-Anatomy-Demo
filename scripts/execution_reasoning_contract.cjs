"use strict";

const REQUEST_VERSION="flythink-execution-request.v1";
const PROPOSAL_VERSION="flythink-execution-proposal.v1";
const FORBIDDEN_SEMANTIC_KEYS=new Set([
  "utterance","text","transcript","frames","focus","ambiguity","semantic_operation"
]);
const ALLOWED_ACTION_OPS=new Set([
  "PATCH_SLOT","PATCH_RELATIVE","CLOSE_DEVICE",
  "ADD_DEVICE","REMOVE_DEVICE","REPLACE_TARGET"
]);

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function canonical(v){
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==="object"){
    const out={};
    for(const k of Object.keys(v).sort())out[k]=canonical(v[k]);
    return out;
  }
  return v;
}
function canonicalString(v){return JSON.stringify(canonical(v))}

function forbiddenSemanticPaths(value,path="$",out=[]){
  if(Array.isArray(value)){
    value.forEach((x,i)=>forbiddenSemanticPaths(x,path+"["+String(i)+"]",out));
    return out;
  }
  if(value&&typeof value==="object"){
    for(const [key,child] of Object.entries(value)){
      const childPath=path+"."+key;
      if(FORBIDDEN_SEMANTIC_KEYS.has(key))out.push(childPath);
      forbiddenSemanticPaths(child,childPath,out);
    }
  }
  return out;
}

function rejectSemanticLeak(value,label){
  const leaked=forbiddenSemanticPaths(value);
  if(leaked.length)throw new Error(label+":"+leaked.join(","));
}

function logicalTarget(target){
  if(!target||typeof target!=="object"||Array.isArray(target))return false;
  const keys=Object.keys(target).sort();
  if(keys.join(",")!=="area,entity,instance")return false;
  return ["area","entity","instance"].every(
    k=>typeof target[k]==="string"&&target[k].length>0
  );
}

function actionTargets(action){
  if(action&&action.op==="REPLACE_TARGET")return [action.from,action.to];
  return [action&&action.target];
}

function validateCandidateAction(action){
  if(!action||typeof action!=="object"||Array.isArray(action))
    throw new Error("candidate_action_must_be_object");
  if(!ALLOWED_ACTION_OPS.has(action.op))
    throw new Error("candidate_action_op_invalid");
  rejectSemanticLeak(action,"semantic_input_forbidden");
  for(const target of actionTargets(action)){
    if(!logicalTarget(target))throw new Error("logical_target_contract_violation");
  }
  return true;
}

function validateExecutionRequest(request){
  if(!request||typeof request!=="object"||Array.isArray(request))
    throw new Error("execution_request_must_be_object");
  if(request.request_version!==REQUEST_VERSION)
    throw new Error("unsupported_execution_request_contract");
  rejectSemanticLeak(request,"semantic_input_forbidden");
  if(typeof request.task_id!=="string"||!request.task_id)
    throw new Error("execution_task_id_required");
  if(!request.goal||typeof request.goal!=="object"||Array.isArray(request.goal))
    throw new Error("execution_goal_must_be_structured_object");
  if(!Array.isArray(request.resolved_targets))
    throw new Error("resolved_targets_must_be_list");
  request.resolved_targets.forEach(target=>{
    if(!logicalTarget(target))throw new Error("logical_target_contract_violation");
  });
  const resolved=new Set(request.resolved_targets.map(canonicalString));
  if(!Array.isArray(request.candidate_actions))
    throw new Error("candidate_actions_must_be_list");
  const seen=new Set();
  request.candidate_actions.forEach(action=>{
    validateCandidateAction(action);
    for(const target of actionTargets(action)){
      if(!resolved.has(canonicalString(target)))
        throw new Error("candidate_action_target_not_resolved");
    }
    const id=canonicalString(action);
    if(seen.has(id))throw new Error("duplicate_candidate_action");
    seen.add(id);
  });
  if(request.constraints!=null&&!Array.isArray(request.constraints))
    throw new Error("execution_constraints_must_be_list");
  return true;
}

function validateExecutionProposal(proposal,request=null){
  if(!proposal||typeof proposal!=="object"||Array.isArray(proposal))
    throw new Error("execution_proposal_must_be_object");
  if(proposal.schema_version!==PROPOSAL_VERSION)
    throw new Error("unsupported_execution_proposal_contract");
  rejectSemanticLeak(proposal,"semantic_output_forbidden");
  if(!["PROPOSE","DEFER","BLOCK"].includes(proposal.decision))
    throw new Error("execution_decision_invalid");
  if(typeof proposal.task_id!=="string"||!proposal.task_id)
    throw new Error("execution_proposal_task_id_required");
  if(!Array.isArray(proposal.proposed_actions))
    throw new Error("proposed_actions_must_be_list");
  proposal.proposed_actions.forEach(validateCandidateAction);
  if(proposal.decision==="PROPOSE"&&proposal.proposed_actions.length===0)
    throw new Error("propose_requires_action");
  if(proposal.decision!=="PROPOSE"&&proposal.proposed_actions.length)
    throw new Error("non_propose_decision_must_not_emit_actions");

  const uncertainty=proposal.uncertainty;
  if(!uncertainty||typeof uncertainty!=="object"||Array.isArray(uncertainty))
    throw new Error("execution_uncertainty_required");
  if(
    typeof uncertainty.score!=="number"||
    !Number.isFinite(uncertainty.score)||
    uncertainty.score<0||uncertainty.score>1
  )throw new Error("execution_uncertainty_score_invalid");
  if(
    !Array.isArray(uncertainty.reasons)||
    !uncertainty.reasons.every(x=>typeof x==="string")
  )throw new Error("execution_uncertainty_reasons_invalid");
  if(
    proposal.evidence_refs!=null&&(
      !Array.isArray(proposal.evidence_refs)||
      !proposal.evidence_refs.every(x=>typeof x==="string")
    )
  )throw new Error("execution_evidence_refs_invalid");

  if(request){
    validateExecutionRequest(request);
    if(proposal.task_id!==request.task_id)
      throw new Error("execution_proposal_task_mismatch");
    const allowed=new Set(request.candidate_actions.map(canonicalString));
    const seen=new Set();
    for(const action of proposal.proposed_actions){
      const id=canonicalString(action);
      if(!allowed.has(id))throw new Error("execution_action_not_in_candidate_set");
      if(seen.has(id))throw new Error("duplicate_proposed_action");
      seen.add(id);
    }
  }
  return true;
}

function patchIdentity(patch){
  if(!patch)return null;
  if(patch.op==="REPLACE_TARGET"){
    return {
      op:patch.op,
      from:clone(patch.from||null),
      to:clone(patch.to||null),
      slot:patch.slot||null
    };
  }
  return {
    op:patch.op||null,
    target:clone(patch.target||null),
    slot:patch.slot||null
  };
}

function samePatchIdentity(a,b){
  return canonicalString(patchIdentity(a))===canonicalString(patchIdentity(b));
}

module.exports={
  REQUEST_VERSION,
  PROPOSAL_VERSION,
  FORBIDDEN_SEMANTIC_KEYS,
  ALLOWED_ACTION_OPS,
  canonical,
  canonicalString,
  forbiddenSemanticPaths,
  rejectSemanticLeak,
  logicalTarget,
  actionTargets,
  validateCandidateAction,
  validateExecutionRequest,
  validateExecutionProposal,
  patchIdentity,
  samePatchIdentity
};
