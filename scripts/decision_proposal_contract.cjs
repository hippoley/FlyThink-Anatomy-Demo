"use strict";

const {assertContextStateSnapshot}=require("./contextual_edge_slu_adapter.cjs");
const {
  REQUEST_VERSION,
  PROPOSAL_VERSION,
  canonicalString,
  logicalTarget,
  validateExecutionRequest,
  validateExecutionProposal
}=require("./execution_reasoning_contract.cjs");

const SCHEMA_VERSION="decision-proposal.v1";
const ALLOWED_MUTATION_OPERATORS=new Set(["SET","ADD"]);
const FORBIDDEN_PHYSICAL_KEYS=new Set([
  "device_id",
  "physical_device_id",
  "hardware_id",
  "hardware_uuid",
  "hardware_identity",
  "windowpilot_id",
  "mqtt_topic",
  "matter_endpoint",
  "physical_target",
  "driver_id"
]);
const FORBIDDEN_RAW_SEMANTIC_KEYS=new Set([
  "utterance",
  "transcript",
  "asr_text",
  "semantic_frames",
  "conversation_graph",
  "task_graph"
]);

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function forbiddenPaths(value,path="$",out=[]){
  if(Array.isArray(value)){
    value.forEach((x,i)=>forbiddenPaths(x,path+"["+String(i)+"]",out));
    return out;
  }
  if(value&&typeof value==="object"){
    for(const [key,child] of Object.entries(value)){
      const childPath=path+"."+key;
      if(FORBIDDEN_PHYSICAL_KEYS.has(key)||FORBIDDEN_RAW_SEMANTIC_KEYS.has(key)){
        out.push(childPath);
      }
      forbiddenPaths(child,childPath,out);
    }
  }
  return out;
}

function validateDecisionProposal(proposal){
  if(!proposal||typeof proposal!=="object"||Array.isArray(proposal))
    throw new Error("decision_proposal_must_be_object");
  if(proposal.schema_version!==SCHEMA_VERSION)
    throw new Error("decision_proposal_schema_invalid");

  const forbidden=forbiddenPaths(proposal);
  if(forbidden.length)
    throw new Error("decision_proposal_forbidden_field:"+forbidden.join(","));

  for(const field of ["proposal_id","task_id","intent"]){
    if(typeof proposal[field]!=="string"||!proposal[field])
      throw new Error("decision_proposal_"+field+"_required");
  }

  if(!Number.isInteger(proposal.context_revision)||proposal.context_revision<0)
    throw new Error("decision_proposal_context_revision_invalid");
  if(
    !Number.isInteger(proposal.world_snapshot_revision)||
    proposal.world_snapshot_revision<0
  )throw new Error("decision_proposal_world_revision_invalid");

  if(!Array.isArray(proposal.logical_targets)||!proposal.logical_targets.length)
    throw new Error("decision_proposal_logical_targets_required");
  const targetSet=new Set();
  for(const target of proposal.logical_targets){
    if(!logicalTarget(target))
      throw new Error("decision_proposal_logical_target_invalid");
    const key=canonicalString(target);
    if(targetSet.has(key))
      throw new Error("decision_proposal_duplicate_logical_target");
    targetSet.add(key);
  }

  if(!Array.isArray(proposal.proposed_mutations)||!proposal.proposed_mutations.length)
    throw new Error("decision_proposal_mutations_required");

  const mutationIdentity=new Set();
  for(const mutation of proposal.proposed_mutations){
    if(!mutation||typeof mutation!=="object"||Array.isArray(mutation))
      throw new Error("decision_proposal_mutation_invalid");
    if(!logicalTarget(mutation.target))
      throw new Error("decision_proposal_mutation_target_invalid");
    if(!targetSet.has(canonicalString(mutation.target)))
      throw new Error("decision_proposal_mutation_target_not_declared");
    if(typeof mutation.property!=="string"||!mutation.property)
      throw new Error("decision_proposal_property_required");
    if(!ALLOWED_MUTATION_OPERATORS.has(mutation.operator))
      throw new Error("decision_proposal_operator_invalid");
    if(!Object.prototype.hasOwnProperty.call(mutation,"value"))
      throw new Error("decision_proposal_value_required");
    if(
      mutation.operator==="ADD"&&
      !Number.isFinite(Number(mutation.value))
    )throw new Error("decision_proposal_relative_value_invalid");
    const identity=canonicalString({
      target:mutation.target,
      property:mutation.property
    });
    if(mutationIdentity.has(identity))
      throw new Error("decision_proposal_conflicting_mutation_identity");
    mutationIdentity.add(identity);
  }

  const confidence=Number(proposal.confidence);
  if(!Number.isFinite(confidence)||confidence<0||confidence>1)
    throw new Error("decision_proposal_confidence_invalid");
  if(typeof proposal.requires_confirmation!=="boolean")
    throw new Error("decision_proposal_requires_confirmation_invalid");
  if(proposal.reason!=null&&typeof proposal.reason!=="string")
    throw new Error("decision_proposal_reason_invalid");
  if(
    proposal.evidence_refs!=null&&(
      !Array.isArray(proposal.evidence_refs)||
      !proposal.evidence_refs.every(x=>typeof x==="string")
    )
  )throw new Error("decision_proposal_evidence_refs_invalid");
  return true;
}

function mutationToAction(mutation){
  if(mutation.operator==="SET"){
    return {
      op:"PATCH_SLOT",
      target:clone(mutation.target),
      slot:mutation.property,
      value:clone(mutation.value)
    };
  }
  if(mutation.operator==="ADD"){
    return {
      op:"PATCH_RELATIVE",
      target:clone(mutation.target),
      slot:mutation.property,
      delta:Number(mutation.value)
    };
  }
  throw new Error("decision_proposal_operator_invalid");
}

function contextRevisionOf(contextualState){
  const value=
    contextualState&&(
      contextualState.context_revision ??
      contextualState.revision
    );
  return Number.isInteger(value)&&value>=0?value:null;
}

function decisionProposalToExecutionContracts(
  contextualState,
  decisionProposal
){
  assertContextStateSnapshot(contextualState);
  validateDecisionProposal(decisionProposal);

  const actualContextRevision=contextRevisionOf(contextualState);
  if(actualContextRevision==null)
    throw new Error("contextual_state_revision_required");
  if(actualContextRevision!==decisionProposal.context_revision)
    throw new Error("decision_proposal_context_revision_mismatch");

  const actions=decisionProposal.proposed_mutations.map(mutationToAction);
  const request={
    request_version:REQUEST_VERSION,
    task_id:decisionProposal.task_id,
    goal:{
      type:"decision_proposal",
      proposal_id:decisionProposal.proposal_id,
      intent:decisionProposal.intent
    },
    resolved_targets:clone(decisionProposal.logical_targets),
    constraints:[],
    candidate_actions:clone(actions)
  };

  const decision=
    decisionProposal.requires_confirmation===true
      ?"DEFER"
      :"PROPOSE";
  const internalProposal={
    schema_version:PROPOSAL_VERSION,
    proposal_id:decisionProposal.proposal_id,
    task_id:decisionProposal.task_id,
    decision,
    strategy:{
      source_contract:SCHEMA_VERSION,
      intent:decisionProposal.intent,
      world_snapshot_revision:decisionProposal.world_snapshot_revision
    },
    proposed_actions:decision==="PROPOSE"?clone(actions):[],
    uncertainty:{
      score:Number((1-Number(decisionProposal.confidence)).toFixed(6)),
      reasons:decisionProposal.requires_confirmation
        ?["CONFIRMATION_REQUIRED"]
        :[]
    },
    evidence_refs:clone(decisionProposal.evidence_refs||[]),
    reason_code:decisionProposal.requires_confirmation
      ?"CONFIRMATION_REQUIRED"
      :"DECISION_PROPOSAL_ACCEPTED"
  };

  validateExecutionRequest(request);
  validateExecutionProposal(internalProposal,request);
  return {
    external_contract:SCHEMA_VERSION,
    proposal_id:decisionProposal.proposal_id,
    world_snapshot_revision:decisionProposal.world_snapshot_revision,
    request,
    internal_proposal:internalProposal
  };
}

module.exports={
  SCHEMA_VERSION,
  ALLOWED_MUTATION_OPERATORS,
  FORBIDDEN_PHYSICAL_KEYS,
  FORBIDDEN_RAW_SEMANTIC_KEYS,
  forbiddenPaths,
  validateDecisionProposal,
  mutationToAction,
  contextRevisionOf,
  decisionProposalToExecutionContracts
};
