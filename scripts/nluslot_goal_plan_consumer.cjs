"use strict";

const {
  REQUEST_VERSION,
  PROPOSAL_VERSION,
  logicalTarget,
  validateExecutionRequest,
  validateExecutionProposal
}=require("./execution_reasoning_contract.cjs");

const NLUSLOT_CONTRACT_VERSION="goal-plan-control.v1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function validateNluslotGoalPlanSnapshot(snapshot){
  if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot))
    throw new Error("nluslot_goal_plan_snapshot_required");
  if(snapshot.contract_version!==NLUSLOT_CONTRACT_VERSION)
    throw new Error("nluslot_goal_plan_contract_unsupported");
  if(!Number.isInteger(snapshot.context_revision)||snapshot.context_revision<0)
    throw new Error("nluslot_goal_plan_context_revision_invalid");
  if(!/^[0-9a-f]{64}$/.test(String(snapshot.registry_schema_sha256||"")))
    throw new Error("nluslot_registry_schema_sha256_invalid");
  if(!Array.isArray(snapshot.goals))
    throw new Error("nluslot_goal_plan_goals_required");
  for(const goal of snapshot.goals){
    if(!goal||typeof goal!=="object"||typeof goal.goal_id!=="string"||!goal.goal_id)
      throw new Error("nluslot_goal_entry_invalid");
    if(!goal.plan||!Number.isInteger(goal.plan.revision)||goal.plan.revision<1)
      throw new Error("nluslot_goal_revision_invalid");
    if(!Array.isArray(goal.plan.actions))
      throw new Error("nluslot_goal_actions_invalid");
    const seen=new Set();
    for(const action of goal.plan.actions){
      if(!action||typeof action!=="object"||!logicalTarget(action.target))
        throw new Error("nluslot_goal_target_invalid");
      if(typeof action.property!=="string"||!action.property)
        throw new Error("nluslot_goal_property_invalid");
      if(typeof action.thing_model!=="string")
        throw new Error("nluslot_goal_thing_model_invalid");
      const identity=JSON.stringify([action.target,action.property]);
      if(seen.has(identity))throw new Error("nluslot_goal_duplicate_mutation");
      seen.add(identity);
    }
    if(!goal.execution||typeof goal.execution.status!=="string")
      throw new Error("nluslot_goal_execution_state_invalid");
  }
  return true;
}

function consumeCommittedGoal(snapshot,goalId){
  validateNluslotGoalPlanSnapshot(snapshot);
  const matches=snapshot.goals.filter(g=>g.goal_id===goalId);
  if(matches.length!==1)throw new Error("nluslot_goal_not_unique");
  const goal=matches[0];
  if(goal.execution.status!=="SEMANTIC_COMMITTED_NOT_EXECUTED"){
    return {
      consumed:false,
      decision:"DEFER",
      reason:"NLUSLOT_PLAN_NOT_READY_FOR_PHYSICAL_EXECUTION"
    };
  }
  if(!goal.task_id)throw new Error("nluslot_committed_goal_task_required");
  if(!goal.plan.actions.length)throw new Error("nluslot_committed_goal_actions_required");

  const resolved=[];
  const resolvedKeys=new Set();
  const actions=goal.plan.actions.map(action=>{
    const key=JSON.stringify(action.target);
    if(!resolvedKeys.has(key)){
      resolved.push(clone(action.target));
      resolvedKeys.add(key);
    }
    return {
      op:"PATCH_SLOT",
      target:clone(action.target),
      slot:action.property,
      value:clone(action.value)
    };
  });
  const request={
    request_version:REQUEST_VERSION,
    task_id:goal.task_id,
    goal:{
      type:"nluslot_goal_plan",
      goal_id:goal.goal_id,
      plan_revision:goal.plan.revision,
      registry_schema_sha256:snapshot.registry_schema_sha256
    },
    resolved_targets:resolved,
    constraints:[],
    candidate_actions:clone(actions)
  };
  const proposal={
    schema_version:PROPOSAL_VERSION,
    proposal_id:"nluslot:"+goal.goal_id+":r"+String(goal.plan.revision),
    task_id:goal.task_id,
    decision:"PROPOSE",
    strategy:{
      source_contract:NLUSLOT_CONTRACT_VERSION,
      context_revision:snapshot.context_revision,
      registry_schema_sha256:snapshot.registry_schema_sha256,
      plan_revision:goal.plan.revision
    },
    proposed_actions:clone(actions),
    uncertainty:{score:0,reasons:[]},
    evidence_refs:[],
    reason_code:"NLUSLOT_SEMANTIC_PLAN_COMMITTED"
  };
  validateExecutionRequest(request);
  validateExecutionProposal(proposal,request);
  return {
    consumed:true,
    decision:"PROPOSE",
    source_contract:NLUSLOT_CONTRACT_VERSION,
    request,
    proposal
  };
}

module.exports={
  NLUSLOT_CONTRACT_VERSION,
  validateNluslotGoalPlanSnapshot,
  consumeCommittedGoal
};
