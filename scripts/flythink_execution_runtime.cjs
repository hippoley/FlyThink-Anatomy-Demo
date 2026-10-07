"use strict";

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
const {
  SCHEMA_VERSION:RECEIPT_VERSION,
  digestObject:sha256Object,
  buildExecutionReceipt,
  verifyExecutionReceipt
}=require("./execution_receipt.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
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

class FlyThinkExecutionRuntime{
  constructor({
    runtime={},
    driver,
    physicalAuthorizer,
    maxUncertainty=0.35,
    receiptLedger=null,
    requireDurableReceipt=false
  }={}){
    this.runtime=normalizeRuntime(runtime);
    this.driver=driver;
    this.physicalAuthorizer=physicalAuthorizer;
    this.maxUncertainty=maxUncertainty;
    this.receiptLedger=receiptLedger;
    this.requireDurableReceipt=requireDurableReceipt===true;
  }

  async execute(input={}){
    const ledger=input.receiptLedger===undefined
      ?this.receiptLedger
      :input.receiptLedger;
    const requireDurable=input.require_durable_receipt==null
      ?this.requireDurableReceipt
      :input.require_durable_receipt===true;
    if(
      requireDurable&&(
        !ledger||typeof ledger.appendVerifiedReceipt!=="function"
      )
    ){
      throw new Error("execution_receipt_ledger_required");
    }

    const beforeRuntime=normalizeRuntime(this.runtime);
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
    const physicalOk=out.ok===true;

    if(!ledger||typeof ledger.appendVerifiedReceipt!=="function"){
      return {
        ...out,
        physical_ok:physicalOk,
        receipt_journal:{
          persisted:false,
          required:requireDurable,
          reason:"execution_receipt_ledger_not_configured"
        }
      };
    }

    try{
      const persisted=ledger.appendVerifiedReceipt(out.receipt,{
        contextual_state:input.contextual_state,
        request:input.request,
        proposal:input.proposal,
        before_runtime:beforeRuntime,
        after_runtime:out.runtime
      });
      return {
        ...out,
        physical_ok:physicalOk,
        receipt_journal:{
          persisted:true,
          required:requireDurable,
          sequence:persisted.event&&persisted.event.sequence||null,
          event_hash:persisted.event&&persisted.event.hash||null,
          seal_digest:persisted.seal&&persisted.seal.seal_digest||null,
          physical_truth_verified:
            persisted.verified&&persisted.verified.physical_truth_verified===true
        }
      };
    }catch(err){
      const failed={
        ...out,
        physical_ok:physicalOk,
        receipt_journal:{
          persisted:false,
          required:requireDurable,
          error:String(err&&err.message||err)
        }
      };
      if(
        requireDurable&&
        out.receipt&&
        out.receipt.physical_committed===true
      ){
        failed.ok=false;
        failed.status="EVIDENCE_NOT_DURABLE";
        failed.reason="execution_receipt_journal_append_failed";
      }
      return failed;
    }
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
  runExecutionProposal,
  FlyThinkExecutionRuntime
};
