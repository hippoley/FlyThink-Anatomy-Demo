"use strict";

const crypto=require("crypto");
const {normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {assertContextStateSnapshot}=require("./contextual_edge_slu_adapter.cjs");
const {
  canonical,
  validateExecutionRequest,
  validateExecutionProposal,
  samePatchIdentity
}=require("./execution_reasoning_contract.cjs");
const {
  evaluateQuarantinePreflight,
  executePhysicalTurn
}=require("./physical_runtime.cjs");
const {executeAtomicPhysicalSet}=require("./atomic_physical_set.cjs");
const {runRecoveryTransaction}=require("./recovery_transaction.cjs");

const RECEIPT_VERSION="flythink-execution-runtime-receipt.v1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function sha256Object(v){
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
}
function physicalReceiptsCommitted(receipts){
  return Array.isArray(receipts)&&
    receipts.length>0&&
    receipts.every(r=>r&&r.status==="applied");
}

function validateAuthorizationResult(result,requestedActions){
  if(!result||typeof result!=="object")
    throw new Error("physical_authorization_result_required");
  if(result.allow!==true)
    throw new Error("physical_authorization_not_allowed");
  if(!Array.isArray(result.patches))
    throw new Error("physical_authorization_patches_required");
  if(result.patches.length!==requestedActions.length)
    throw new Error("physical_authorization_patch_count_mismatch");
  if(!result.receipt||typeof result.receipt!=="object")
    throw new Error("physical_authorization_receipt_required");

  for(let i=0;i<requestedActions.length;i++){
    if(!samePatchIdentity(requestedActions[i],result.patches[i])){
      throw new Error("physical_authorization_patch_identity_mismatch:"+String(i));
    }
  }
  return {
    allow:true,
    patches:clone(result.patches),
    receipt:clone(result.receipt)
  };
}

function buildRuntimeReceipt({
  contextual_state,
  request,
  proposal,
  authorization=null,
  authorized_actions=[],
  physical_receipts=[],
  status,
  reason=null,
  atomic_batch=false,
  physical_committed=false
}={}){
  const core={
    schema_version:RECEIPT_VERSION,
    task_id:request&&request.task_id||null,
    status,
    reason,
    contextual_state_sha256:sha256Object(contextual_state||null),
    request_sha256:sha256Object(request||null),
    proposal_sha256:sha256Object(proposal||null),
    authorization_granted:!!authorization,
    authorization_receipt_sha256:authorization
      ?sha256Object(authorization)
      :null,
    authorized_action_count:Array.isArray(authorized_actions)
      ?authorized_actions.length
      :0,
    physical_receipt_ids:(physical_receipts||[])
      .map(x=>x&&x.command_id||null)
      .filter(Boolean),
    physical_committed:physical_committed===true,
    atomic_batch:atomic_batch===true
  };
  return {...core,receipt_sha256:sha256Object(core)};
}

async function runExecutionProposal({
  runtime,
  contextual_state,
  request,
  proposal,
  driver,
  physicalAuthorizer,
  authorization_context={},
  source_step=0,
  source_revision=0,
  max_uncertainty=0.35
}={}){
  assertContextStateSnapshot(contextual_state);
  validateExecutionRequest(request);
  validateExecutionProposal(proposal,request);

  let current=normalizeRuntime(runtime||{});
  const noExecution=(status,reason)=>({
    ok:false,
    status,
    reason,
    runtime:current,
    authorization:null,
    authorized_actions:[],
    physical_receipts:[],
    receipt:buildRuntimeReceipt({
      contextual_state,request,proposal,status,reason
    })
  });

  if(proposal.decision==="DEFER")
    return noExecution("DEFERRED","reasoner_deferred");
  if(proposal.decision==="BLOCK")
    return noExecution("BLOCKED","reasoner_blocked");

  const uncertainty=Number(proposal.uncertainty&&proposal.uncertainty.score);
  const max=Number(max_uncertainty);
  if(!Number.isFinite(max)||max<0||max>1)
    throw new Error("execution_max_uncertainty_invalid");
  if(uncertainty>max)
    return noExecution("DEFERRED","reasoning_uncertainty_above_threshold");

  const requested=clone(proposal.proposed_actions||[]);
  const preflight=evaluateQuarantinePreflight(current,requested);
  if(!preflight.allow){
    return {
      ...noExecution("BLOCKED","device_quarantined"),
      quarantine_preflight:clone(preflight)
    };
  }

  if(typeof physicalAuthorizer!=="function")
    return noExecution("BLOCKED","physical_authorizer_required");

  let rawAuthorization;
  try{
    rawAuthorization=await physicalAuthorizer({
      runtime:clone(current),
      patches:clone(requested),
      event:{turn_id:request.task_id},
      context:clone(authorization_context||{}),
      source_step,
      source_revision
    });
  }catch(err){
    return {
      ...noExecution("BLOCKED","physical_authorization_blocked"),
      authorization_error:String(err&&err.message||err),
      authorization_receipt:clone(err&&err.receipt||null)
    };
  }

  let authorization;
  try{
    authorization=validateAuthorizationResult(rawAuthorization,requested);
  }catch(err){
    return {
      ...noExecution("BLOCKED","physical_authorization_invalid"),
      authorization_error:String(err&&err.message||err),
      authorization_receipt:clone(
        rawAuthorization&&rawAuthorization.receipt||null
      )
    };
  }

  const authorized=authorization.patches;
  const atomic=authorized.length>1;
  let physical;
  if(atomic){
    physical=await executeAtomicPhysicalSet(
      current,
      authorized,
      driver,
      {turn_id:request.task_id}
    );
  }else{
    physical=await executePhysicalTurn(
      current,
      authorized,
      driver,
      {turn_id:request.task_id}
    );
  }
  current=physical.runtime;

  const committed=
    physical.ok===true&&
    physicalReceiptsCommitted(physical.receipts);

  const status=committed?"EXECUTED":"PHYSICAL_NOT_COMMITTED";
  const reason=committed?null:(physical.reason||"physical_receipt_not_applied");
  const receipt=buildRuntimeReceipt({
    contextual_state,
    request,
    proposal,
    authorization:authorization.receipt,
    authorized_actions:authorized,
    physical_receipts:physical.receipts,
    status,
    reason,
    atomic_batch:atomic,
    physical_committed:committed
  });

  return {
    ok:committed,
    status,
    reason,
    runtime:current,
    authorization:clone(authorization.receipt),
    authorized_actions:clone(authorized),
    physical_receipts:clone(physical.receipts||[]),
    atomic_batch:atomic,
    receipt
  };
}

class FlyThinkExecutionRuntime{
  constructor({
    runtime={},
    driver,
    physicalAuthorizer,
    maxUncertainty=0.35
  }={}){
    this.runtime=normalizeRuntime(runtime);
    this.driver=driver;
    this.physicalAuthorizer=physicalAuthorizer;
    this.maxUncertainty=maxUncertainty;
  }

  async execute(input={}){
    const out=await runExecutionProposal({
      ...input,
      runtime:this.runtime,
      driver:input.driver||this.driver,
      physicalAuthorizer:input.physicalAuthorizer||this.physicalAuthorizer,
      max_uncertainty:input.max_uncertainty==null
        ?this.maxUncertainty
        :input.max_uncertainty
    });
    this.runtime=out.runtime;
    return out;
  }

  async recover(input={}){
    const out=await runRecoveryTransaction(this.runtime,{
      ...input,
      driver:input.driver||this.driver
    });
    this.runtime=out.runtime;
    return out;
  }

  snapshot(){
    return clone(this.runtime);
  }
}

module.exports={
  RECEIPT_VERSION,
  sha256Object,
  physicalReceiptsCommitted,
  validateAuthorizationResult,
  buildRuntimeReceipt,
  runExecutionProposal,
  FlyThinkExecutionRuntime
};
