"use strict";

const {normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {assertContextStateSnapshot}=require("./contextual_edge_slu_adapter.cjs");
const {
  validateDecisionProposal,
  decisionProposalToExecutionContracts
}=require("./decision_proposal_contract.cjs");
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
const {runtimeRegistryDigest}=require("./spatialruntime_authorizer.cjs");
const {
  SCHEMA_VERSION:RECEIPT_VERSION,
  digestObject:sha256Object,
  buildExecutionReceipt,
  verifyExecutionReceipt
}=require("./execution_receipt.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function runtimeWorldRevision(runtime){
  return runtime&&Array.isArray(runtime.revisions)?runtime.revisions.length:0;
}
function physicalReceiptsCommitted(receipts){
  return Array.isArray(receipts)&&
    receipts.length>0&&
    receipts.every(r=>r&&r.status==="applied");
}

function isSha256(v){return /^[0-9a-f]{64}$/.test(String(v||""))}

function validateAuthorizationResult(
  result,
  requestedActions,
  {
    task_id=null,
    source_step=0,
    source_revision=0,
    runtime=null
  }={}
){
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
  const receipt=result.receipt;
  if(receipt.allow!==true)
    throw new Error("physical_authorization_receipt_not_allowed");
  if(receipt.single_use!==true)
    throw new Error("physical_authorization_single_use_required");
  if(!isSha256(receipt.authorization_id))
    throw new Error("physical_authorization_id_invalid");
  if(!isSha256(receipt.patch_digest)||
     receipt.patch_digest!==sha256Object(result.patches))
    throw new Error("physical_authorization_patch_digest_mismatch");
  if(!isSha256(receipt.registry_digest))
    throw new Error("physical_authorization_registry_digest_invalid");
  if(!runtime)
    throw new Error("physical_authorization_runtime_required");
  if(receipt.registry_digest!==runtimeRegistryDigest(runtime))
    throw new Error("physical_authorization_registry_digest_mismatch");
  if(!Array.isArray(receipt.authorized_patches)||
     sha256Object(receipt.authorized_patches)!==sha256Object(result.patches))
    throw new Error("physical_authorization_receipt_patches_mismatch");
  if(!isSha256(receipt.receipt_sha256))
    throw new Error("physical_authorization_receipt_sha256_invalid");
  const receiptBase=clone(receipt);
  delete receiptBase.receipt_sha256;
  if(sha256Object(receiptBase)!==receipt.receipt_sha256)
    throw new Error("physical_authorization_receipt_sha256_mismatch");
  if(typeof receipt.case_id!=="string"||receipt.case_id!==String(task_id||""))
    throw new Error("physical_authorization_case_id_mismatch");
  if(Number(receipt.source_step)!==Number(source_step))
    throw new Error("physical_authorization_source_step_mismatch");
  if(Number(receipt.source_revision)!==Number(source_revision))
    throw new Error("physical_authorization_source_revision_mismatch");

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
  physical_committed=false,
  before_runtime=null,
  after_runtime=null,
  source_step=0,
  source_revision=0,
  closeout=null
}={}){
  return buildExecutionReceipt({
    contextual_state,
    request,
    proposal,
    authorization,
    authorized_actions,
    physical_receipts,
    before_runtime,
    after_runtime,
    status,
    reason,
    atomic_batch,
    physical_committed,
    source_step,
    source_revision,
    closeout
  });
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
  max_uncertainty=0.35,
  authorizationLedger=null
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
      contextual_state,
      request,
      proposal,
      status,
      reason,
      before_runtime:current,
      after_runtime:current,
      source_step,
      source_revision
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
  if(!driver||typeof driver!=="object")
    return noExecution("BLOCKED","physical_driver_required");

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
    authorization=validateAuthorizationResult(
      rawAuthorization,
      requested,
      {
        task_id:request.task_id,
        source_step,
        source_revision,
        runtime:current
      }
    );
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
  const authReceipt=authorization.receipt;
  if(!authorizationLedger||typeof authorizationLedger.add!=="function"){
    return {
      ...noExecution("BLOCKED","authorization_ledger_required"),
      authorization_receipt:clone(authReceipt)
    };
  }
  const consumed=authorizationLedger.add(authReceipt.authorization_id,{
    task_id:request.task_id,
    receipt_sha256:authReceipt.receipt_sha256||null,
    patch_digest:authReceipt.patch_digest,
    registry_digest:authReceipt.registry_digest
  });
  if(consumed===false){
    return {
      ...noExecution("BLOCKED","physical_authorization_replayed"),
      authorization_receipt:clone(authReceipt)
    };
  }

  const authorizedPreflight=evaluateQuarantinePreflight(current,authorized);
  if(!authorizedPreflight.allow){
    return {
      ...noExecution("BLOCKED","authorized_patch_violates_quarantine"),
      authorization:clone(authReceipt),
      authorized_actions:clone(authorized),
      authorization_consumed:true,
      quarantine_preflight:clone(authorizedPreflight)
    };
  }

  const atomic=authorized.length>1;
  const beforePhysical=normalizeRuntime(current);
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
    physical_committed:committed,
    before_runtime:beforePhysical,
    after_runtime:current,
    source_step,
    source_revision
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

async function runDecisionProposal({
  runtime,
  contextual_state,
  decision_proposal,
  driver,
  physicalAuthorizer,
  authorization_context={},
  source_step=0,
  max_uncertainty=0.35,
  authorizationLedger=null
}={}){
  assertContextStateSnapshot(contextual_state);
  validateDecisionProposal(decision_proposal);

  const current=normalizeRuntime(runtime||{});
  const worldRevision=runtimeWorldRevision(current);
  if(worldRevision!==decision_proposal.world_snapshot_revision){
    const {request,internal_proposal}=decisionProposalToExecutionContracts(
      contextual_state,
      decision_proposal
    );
    const receipt=buildRuntimeReceipt({
      contextual_state,
      request,
      proposal:internal_proposal,
      status:"BLOCKED",
      reason:"decision_proposal_world_revision_mismatch",
      before_runtime:current,
      after_runtime:current,
      source_step,
      source_revision:worldRevision
    });
    return {
      ok:false,
      status:"BLOCKED",
      reason:"decision_proposal_world_revision_mismatch",
      expected_world_snapshot_revision:worldRevision,
      supplied_world_snapshot_revision:decision_proposal.world_snapshot_revision,
      runtime:current,
      authorization:null,
      authorized_actions:[],
      physical_receipts:[],
      receipt
    };
  }

  const {request,internal_proposal}=decisionProposalToExecutionContracts(
    contextual_state,
    decision_proposal
  );
  return runExecutionProposal({
    runtime:current,
    contextual_state,
    request,
    proposal:internal_proposal,
    driver,
    physicalAuthorizer,
    authorization_context,
    source_step,
    source_revision:decision_proposal.world_snapshot_revision,
    max_uncertainty,
    authorizationLedger
  });
}

class FlyThinkExecutionRuntime{
  constructor({
    runtime={},
    driver,
    physicalAuthorizer,
    maxUncertainty=0.35,
    authorizationLedger=null
  }={}){
    this.runtime=normalizeRuntime(runtime);
    this.driver=driver;
    this.physicalAuthorizer=physicalAuthorizer;
    this.maxUncertainty=maxUncertainty;
    this.authorizationLedger=authorizationLedger;
  }

  async execute(input={}){
    const out=await runExecutionProposal({
      ...input,
      runtime:this.runtime,
      driver:input.driver||this.driver,
      physicalAuthorizer:input.physicalAuthorizer||this.physicalAuthorizer,
      max_uncertainty:input.max_uncertainty==null
        ?this.maxUncertainty
        :input.max_uncertainty,
      authorizationLedger:input.authorizationLedger||this.authorizationLedger
    });
    this.runtime=out.runtime;
    return out;
  }

  async executeDecisionProposal(input={}){
    const out=await runDecisionProposal({
      ...input,
      runtime:this.runtime,
      driver:input.driver||this.driver,
      physicalAuthorizer:input.physicalAuthorizer||this.physicalAuthorizer,
      max_uncertainty:input.max_uncertainty==null
        ?this.maxUncertainty
        :input.max_uncertainty,
      authorizationLedger:input.authorizationLedger||this.authorizationLedger
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
  buildExecutionReceipt,
  verifyExecutionReceipt,
  runtimeWorldRevision,
  runExecutionProposal,
  runDecisionProposal,
  FlyThinkExecutionRuntime
};
