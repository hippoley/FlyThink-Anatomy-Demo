"use strict";

const crypto=require("crypto");
const {deviceKey}=require("./whole_home_patch_contract.cjs");
const {canonical}=require("./execution_reasoning_contract.cjs");
const {runtimeRegistryDigest}=require("./spatialruntime_authorizer.cjs");

const SCHEMA_VERSION="execution-receipt.v1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function digestObject(v){
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
}
function isDigest(v){return /^[0-9a-f]{64}$/.test(String(v||""))}
function sameTarget(a,b){
  if(!a||!b)return false;
  try{return deviceKey(a)===deviceKey(b)}catch(e){return false}
}
function patchTarget(patch){
  if(!patch)return null;
  if(patch.op==="REPLACE_TARGET")return patch.to||null;
  return patch.target||null;
}
function observationTick(receipt){
  const evidence=receipt&&receipt.observation&&receipt.observation.evidence||{};
  const tick=Number(evidence.tick);
  return Number.isFinite(tick)?tick:null;
}
function evidenceAckTimes(receipt){
  const evidence=receipt&&receipt.observation&&receipt.observation.evidence||{};
  const ackAt=Number(evidence.ack_at_ms);
  const receivedAt=Number(evidence.received_at_ms);
  return {
    ack_at_ms:Number.isFinite(ackAt)?ackAt:null,
    received_at_ms:Number.isFinite(receivedAt)?receivedAt:null
  };
}
function physicalEvidenceRow(receipt,index){
  const semantic=clone(receipt&&receipt.patch||null);
  const physical=clone(receipt&&receipt.physical_patch||semantic||null);
  const observation=clone(receipt&&receipt.observation||null);
  const logicalTarget=patchTarget(semantic);
  const physicalTarget=patchTarget(physical);
  const observationTarget=observation&&observation.target||null;
  const rawBeforeTick=receipt&&receipt.before_tick;
  const beforeTick=rawBeforeTick==null?null:Number(rawBeforeTick);
  const afterTick=observationTick(receipt);
  const times=evidenceAckTimes(receipt);
  const ack=clone(receipt&&receipt.ack||null);
  const hardwareBefore=receipt&&receipt.hardware_identity_before||null;
  const hardwareAfter=receipt&&receipt.hardware_identity_after||null;
  const measured=observation&&observation.evidence&&observation.evidence.measured===true;

  const targetMatch=
    !!logicalTarget&&
    !!physicalTarget&&
    !!observationTarget&&
    sameTarget(logicalTarget,physicalTarget)&&
    sameTarget(physicalTarget,observationTarget);
  const ackVerified=!!ack&&ack.ok===true;
  const freshReadback=
    Number.isFinite(beforeTick)&&
    Number.isFinite(afterTick)&&
    afterTick>beforeTick&&
    times.ack_at_ms!=null&&
    times.received_at_ms!=null&&
    times.received_at_ms>=times.ack_at_ms;
  const identityStable=
    typeof hardwareBefore==="string"&&hardwareBefore.length>0&&
    typeof hardwareAfter==="string"&&hardwareAfter.length>0&&
    hardwareBefore===hardwareAfter;

  return {
    index,
    command_id:receipt&&receipt.command_id||null,
    status:receipt&&receipt.status||null,
    reason:receipt&&receipt.reason||null,
    semantic_patch:semantic,
    physical_patch:physical,
    observation,
    ack,
    before_tick:beforeTick!=null&&Number.isFinite(beforeTick)?beforeTick:null,
    after_tick:afterTick,
    requested_position_pct:
      receipt&&receipt.requested_position_pct==null
        ?null
        :Number(receipt.requested_position_pct),
    hardware_identity:{
      before:hardwareBefore,
      after:hardwareAfter
    },
    readiness:{
      before:clone(receipt&&receipt.readiness_before||null),
      after:clone(receipt&&receipt.readiness_after||null)
    },
    safety_stop:clone(receipt&&receipt.safety_stop||null),
    checks:{
      target_match:targetMatch,
      ack_verified:ackVerified,
      fresh_readback_verified:freshReadback,
      hardware_identity_stable:identityStable,
      measured_readback:measured
    }
  };
}

function authorizationReceiptVerification(
  authorization,
  authorizedActions=[],
  beforeRuntime=null
){
  if(!authorization||typeof authorization!=="object"){
    return {
      receipt_integrity_verified:false,
      authorized_patches_verified:false,
      patch_digest_verified:false,
      registry_digest_verified:false,
      authorization_id_verified:false,
      single_use_verified:false,
      runtime_registry_binding_verified:false
    };
  }
  let receiptIntegrity=false;
  if(isDigest(authorization.receipt_sha256)){
    const base=clone(authorization);
    const saved=base.receipt_sha256;
    delete base.receipt_sha256;
    receiptIntegrity=digestObject(base)===saved;
  }
  const authorizedPatchesVerified=
    Array.isArray(authorization.authorized_patches)&&
    digestObject(authorization.authorized_patches)===digestObject(authorizedActions);
  const patchDigestVerified=
    isDigest(authorization.patch_digest)&&
    authorization.patch_digest===digestObject(authorizedActions);
  const registryDigestVerified=isDigest(authorization.registry_digest);
  const authorizationIdVerified=isDigest(authorization.authorization_id);
  const singleUseVerified=authorization.single_use===true;
  let runtimeRegistryBindingVerified=false;
  try{
    runtimeRegistryBindingVerified=
      !!beforeRuntime&&
      authorization.registry_digest===runtimeRegistryDigest(beforeRuntime);
  }catch(e){
    runtimeRegistryBindingVerified=false;
  }
  return {
    receipt_integrity_verified:receiptIntegrity,
    authorized_patches_verified:authorizedPatchesVerified,
    patch_digest_verified:patchDigestVerified,
    registry_digest_verified:registryDigestVerified,
    authorization_id_verified:authorizationIdVerified,
    single_use_verified:singleUseVerified,
    runtime_registry_binding_verified:runtimeRegistryBindingVerified
  };
}

function resultFromStatus(status,physicalCommitted,physicalTruthVerified=false){
  if(status==="EXECUTED"&&physicalCommitted){
    return physicalTruthVerified?"APPLIED":"APPLIED_UNVERIFIED";
  }
  if(status==="DEFERRED")return "DEFERRED";
  if(status==="BLOCKED")return "BLOCKED";
  if(status==="PHYSICAL_NOT_COMMITTED")return "NOT_COMMITTED";
  return String(status||"UNKNOWN");
}

function receiptCore(receipt){
  const out=clone(receipt);
  delete out.receipt_sha256;
  return out;
}

function buildExecutionReceipt({
  contextual_state,
  request,
  proposal,
  authorization=null,
  authorized_actions=[],
  physical_receipts=[],
  before_runtime=null,
  after_runtime=null,
  status,
  reason=null,
  atomic_batch=false,
  physical_committed=false,
  source_step=0,
  source_revision=0,
  closeout=null
}={}){
  if(!contextual_state||typeof contextual_state!=="object")
    throw new Error("execution_receipt_context_required");
  if(!request||typeof request!=="object")
    throw new Error("execution_receipt_request_required");
  if(!proposal||typeof proposal!=="object")
    throw new Error("execution_receipt_proposal_required");
  if(!Array.isArray(authorized_actions))
    throw new Error("execution_receipt_authorized_actions_required");
  if(!Array.isArray(physical_receipts))
    throw new Error("execution_receipt_physical_receipts_required");

  const evidence=physical_receipts.map(physicalEvidenceRow);
  const allApplied=
    evidence.length>0&&
    evidence.every(x=>x.status==="applied");
  if(physical_committed===true&&!allApplied)
    throw new Error("execution_receipt_committed_requires_applied_receipts");
  if(status==="EXECUTED"&&physical_committed!==true)
    throw new Error("execution_receipt_executed_requires_physical_commit");

  for(const row of evidence){
    if(row.status==="applied"&&row.checks.target_match!==true){
      throw new Error(
        "execution_receipt_target_binding_mismatch:"+String(row.index)
      );
    }
  }

  const verifiedRows=evidence.filter(x=>x.status==="applied");
  const authorizationReceiptChecks=
    authorizationReceiptVerification(
      authorization,
      authorized_actions,
      before_runtime
    );
  const authorizationBindingVerified=
    authorized_actions.length===evidence.length&&
    authorized_actions.every((action,index)=>
      digestObject(action)===digestObject(evidence[index]&&evidence[index].semantic_patch)
    );
  const logicalTargetKeys=new Set(
    (request.resolved_targets||[]).map(target=>{
      try{return deviceKey(target)}catch(e){return null}
    }).filter(Boolean)
  );
  const logicalTargetBindingVerified=
    authorized_actions.length>0&&
    authorized_actions.every(action=>{
      const target=patchTarget(action);
      try{return !!target&&logicalTargetKeys.has(deviceKey(target))}
      catch(e){return false}
    });
  const verification={
    authorization_receipt_integrity_verified:
      authorizationReceiptChecks.receipt_integrity_verified,
    authorization_receipt_patches_verified:
      authorizationReceiptChecks.authorized_patches_verified,
    authorization_patch_digest_verified:
      authorizationReceiptChecks.patch_digest_verified,
    authorization_registry_digest_verified:
      authorizationReceiptChecks.registry_digest_verified,
    authorization_id_verified:
      authorizationReceiptChecks.authorization_id_verified,
    authorization_single_use_verified:
      authorizationReceiptChecks.single_use_verified,
    authorization_runtime_registry_binding_verified:
      authorizationReceiptChecks.runtime_registry_binding_verified,
    authorization_binding_verified:authorizationBindingVerified,
    logical_target_binding_verified:logicalTargetBindingVerified,
    target_binding_verified:
      verifiedRows.length>0&&verifiedRows.every(x=>x.checks.target_match),
    ack_verified:
      verifiedRows.length>0&&verifiedRows.every(x=>x.checks.ack_verified),
    fresh_readback_verified:
      verifiedRows.length>0&&verifiedRows.every(x=>x.checks.fresh_readback_verified),
    hardware_identity_verified:
      verifiedRows.length>0&&verifiedRows.every(x=>x.checks.hardware_identity_stable),
    measured_readback_verified:
      verifiedRows.length>0&&verifiedRows.every(x=>x.checks.measured_readback)
  };
  verification.physical_truth_verified=
    physical_committed===true&&
    verification.authorization_receipt_integrity_verified&&
    verification.authorization_receipt_patches_verified&&
    verification.authorization_patch_digest_verified&&
    verification.authorization_registry_digest_verified&&
    verification.authorization_id_verified&&
    verification.authorization_single_use_verified&&
    verification.authorization_runtime_registry_binding_verified&&
    verification.authorization_binding_verified&&
    verification.logical_target_binding_verified&&
    verification.target_binding_verified&&
    verification.ack_verified&&
    verification.fresh_readback_verified&&
    verification.hardware_identity_verified&&
    verification.measured_readback_verified;

  if(
    physical_committed===true&&
    verification.authorization_binding_verified!==true
  )throw new Error("execution_receipt_authorization_binding_mismatch");
  if(
    physical_committed===true&&
    verification.logical_target_binding_verified!==true
  )throw new Error("execution_receipt_logical_target_binding_mismatch");

  const contextRevision=
    contextual_state.context_revision ??
    contextual_state.revision ??
    null;
  const worldRevisionBefore=
    before_runtime&&Array.isArray(before_runtime.revisions)
      ?before_runtime.revisions.length
      :null;
  const worldRevisionAfter=
    after_runtime&&Array.isArray(after_runtime.revisions)
      ?after_runtime.revisions.length
      :null;

  const receipt={
    schema_version:SCHEMA_VERSION,
    task_id:String(request.task_id||""),
    proposal_id:proposal.proposal_id||null,
    context_revision:contextRevision,
    world_revision:{
      before:worldRevisionBefore,
      after:worldRevisionAfter
    },
    source_step:Number.isInteger(source_step)?source_step:0,
    source_revision:Number.isInteger(source_revision)?source_revision:0,
    logical_targets:clone(request.resolved_targets||[]),
    context_sha256:digestObject(contextual_state),
    request_sha256:digestObject(request),
    proposal_sha256:digestObject(proposal),
    authorization:{
      granted:!!authorization,
      receipt:clone(authorization),
      receipt_sha256:authorization?digestObject(authorization):null,
      authorized_actions:clone(authorized_actions),
      authorized_actions_sha256:digestObject(authorized_actions)
    },
    physical:{
      committed:physical_committed===true,
      atomic_batch:atomic_batch===true,
      evidence,
      evidence_sha256:digestObject(evidence)
    },
    authorization_granted:!!authorization,
    physical_committed:physical_committed===true,
    atomic_batch:atomic_batch===true,
    runtime_status:String(status||"UNKNOWN"),
    result:resultFromStatus(
      status,
      physical_committed===true,
      verification.physical_truth_verified
    ),
    reason:reason||null,
    reconcile:{
      before_runtime_sha256:before_runtime?digestObject(before_runtime):null,
      after_runtime_sha256:after_runtime?digestObject(after_runtime):null
    },
    closeout:clone(closeout||null),
    verification
  };
  receipt.evidence_digest=digestObject({
    authorization:receipt.authorization,
    physical:receipt.physical,
    reconcile:receipt.reconcile,
    closeout:receipt.closeout
  });
  receipt.receipt_sha256=digestObject(receiptCore(receipt));
  return receipt;
}

function verifyExecutionReceipt(receipt={},{
  contextual_state=null,
  request=null,
  proposal=null,
  before_runtime=null,
  after_runtime=null
}={}){
  if(!receipt||receipt.schema_version!==SCHEMA_VERSION)
    throw new Error("execution_receipt_schema_invalid");
  if(!isDigest(receipt.receipt_sha256))
    throw new Error("execution_receipt_digest_invalid");
  const expected=digestObject(receiptCore(receipt));
  if(expected!==receipt.receipt_sha256)
    throw new Error("execution_receipt_digest_mismatch");

  for(const [name,value] of [
    ["context",receipt.context_sha256],
    ["request",receipt.request_sha256],
    ["proposal",receipt.proposal_sha256],
    ["evidence",receipt.evidence_digest]
  ]){
    if(!isDigest(value))throw new Error("execution_receipt_"+name+"_digest_invalid");
  }
  if(contextual_state&&receipt.context_sha256!==digestObject(contextual_state))
    throw new Error("execution_receipt_context_mismatch");
  if(request&&receipt.request_sha256!==digestObject(request))
    throw new Error("execution_receipt_request_mismatch");
  if(proposal&&receipt.proposal_sha256!==digestObject(proposal))
    throw new Error("execution_receipt_proposal_mismatch");
  if(
    before_runtime&&
    receipt.reconcile&&
    receipt.reconcile.before_runtime_sha256!==digestObject(before_runtime)
  )throw new Error("execution_receipt_before_runtime_mismatch");
  if(
    after_runtime&&
    receipt.reconcile&&
    receipt.reconcile.after_runtime_sha256!==digestObject(after_runtime)
  )throw new Error("execution_receipt_after_runtime_mismatch");

  const auth=receipt.authorization||{};
  if(
    receipt.verification&&
    receipt.verification.authorization_runtime_registry_binding_verified===true&&
    !before_runtime
  ){
    throw new Error("execution_receipt_before_runtime_required_for_registry_verification");
  }
  if(auth.receipt){
    if(auth.receipt_sha256!==digestObject(auth.receipt))
      throw new Error("execution_receipt_authorization_digest_mismatch");
  }else if(auth.receipt_sha256!=null){
    throw new Error("execution_receipt_authorization_receipt_missing");
  }
  if(auth.authorized_actions_sha256!==digestObject(auth.authorized_actions||[]))
    throw new Error("execution_receipt_authorized_actions_digest_mismatch");

  const physical=receipt.physical||{};
  if(!Array.isArray(physical.evidence))
    throw new Error("execution_receipt_physical_evidence_invalid");
  if(physical.evidence_sha256!==digestObject(physical.evidence))
    throw new Error("execution_receipt_physical_evidence_digest_mismatch");

  const rebuiltRows=physical.evidence.map((row,index)=>{
    const synthetic={
      command_id:row.command_id,
      status:row.status,
      reason:row.reason,
      patch:row.semantic_patch,
      physical_patch:row.physical_patch,
      observation:row.observation,
      ack:row.ack,
      before_tick:row.before_tick,
      requested_position_pct:row.requested_position_pct,
      hardware_identity_before:row.hardware_identity&&row.hardware_identity.before,
      hardware_identity_after:row.hardware_identity&&row.hardware_identity.after,
      readiness_before:row.readiness&&row.readiness.before,
      readiness_after:row.readiness&&row.readiness.after,
      safety_stop:row.safety_stop
    };
    return physicalEvidenceRow(synthetic,index);
  });
  if(digestObject(rebuiltRows)!==digestObject(physical.evidence))
    throw new Error("execution_receipt_physical_checks_mismatch");

  if(
    physical.committed===true&&
    !physical.evidence.length
  )throw new Error("execution_receipt_committed_without_evidence");
  if(
    physical.committed===true&&
    physical.evidence.some(x=>x.status!=="applied")
  )throw new Error("execution_receipt_committed_with_non_applied_receipt");
  if(
    physical.evidence.some(
      x=>x.status==="applied"&&x.checks&&x.checks.target_match!==true
    )
  )throw new Error("execution_receipt_target_binding_mismatch");

  const verification=receipt.verification||{};
  const applied=rebuiltRows.filter(x=>x.status==="applied");
  const authorizedActions=auth.authorized_actions||[];
  const authorizationReceiptChecks=
    authorizationReceiptVerification(
      auth.receipt,
      authorizedActions,
      before_runtime
    );
  const authorizationBindingVerified=
    authorizedActions.length===rebuiltRows.length&&
    authorizedActions.every((action,index)=>
      digestObject(action)===digestObject(rebuiltRows[index]&&rebuiltRows[index].semantic_patch)
    );
  const logicalTargetKeys=new Set(
    (receipt.logical_targets||[]).map(target=>{
      try{return deviceKey(target)}catch(e){return null}
    }).filter(Boolean)
  );
  const logicalTargetBindingVerified=
    authorizedActions.length>0&&
    authorizedActions.every(action=>{
      const target=patchTarget(action);
      try{return !!target&&logicalTargetKeys.has(deviceKey(target))}
      catch(e){return false}
    });
  const expectedVerification={
    authorization_receipt_integrity_verified:
      authorizationReceiptChecks.receipt_integrity_verified,
    authorization_receipt_patches_verified:
      authorizationReceiptChecks.authorized_patches_verified,
    authorization_patch_digest_verified:
      authorizationReceiptChecks.patch_digest_verified,
    authorization_registry_digest_verified:
      authorizationReceiptChecks.registry_digest_verified,
    authorization_id_verified:
      authorizationReceiptChecks.authorization_id_verified,
    authorization_single_use_verified:
      authorizationReceiptChecks.single_use_verified,
    authorization_runtime_registry_binding_verified:
      authorizationReceiptChecks.runtime_registry_binding_verified,
    authorization_binding_verified:authorizationBindingVerified,
    logical_target_binding_verified:logicalTargetBindingVerified,
    target_binding_verified:
      applied.length>0&&applied.every(x=>x.checks.target_match),
    ack_verified:
      applied.length>0&&applied.every(x=>x.checks.ack_verified),
    fresh_readback_verified:
      applied.length>0&&applied.every(x=>x.checks.fresh_readback_verified),
    hardware_identity_verified:
      applied.length>0&&applied.every(x=>x.checks.hardware_identity_stable),
    measured_readback_verified:
      applied.length>0&&applied.every(x=>x.checks.measured_readback)
  };
  expectedVerification.physical_truth_verified=
    physical.committed===true&&
    expectedVerification.authorization_receipt_integrity_verified&&
    expectedVerification.authorization_receipt_patches_verified&&
    expectedVerification.authorization_patch_digest_verified&&
    expectedVerification.authorization_registry_digest_verified&&
    expectedVerification.authorization_id_verified&&
    expectedVerification.authorization_single_use_verified&&
    expectedVerification.authorization_runtime_registry_binding_verified&&
    expectedVerification.authorization_binding_verified&&
    expectedVerification.logical_target_binding_verified&&
    expectedVerification.target_binding_verified&&
    expectedVerification.ack_verified&&
    expectedVerification.fresh_readback_verified&&
    expectedVerification.hardware_identity_verified&&
    expectedVerification.measured_readback_verified;
  if(digestObject(verification)!==digestObject(expectedVerification))
    throw new Error("execution_receipt_verification_summary_mismatch");

  const expectedResult=resultFromStatus(
    receipt.runtime_status,
    physical.committed===true,
    expectedVerification.physical_truth_verified
  );
  if(receipt.result!==expectedResult)
    throw new Error("execution_receipt_result_mismatch");

  const expectedEvidenceDigest=digestObject({
    authorization:receipt.authorization,
    physical:receipt.physical,
    reconcile:receipt.reconcile,
    closeout:receipt.closeout
  });
  if(receipt.evidence_digest!==expectedEvidenceDigest)
    throw new Error("execution_receipt_evidence_digest_mismatch");

  return {
    valid:true,
    receipt_sha256:receipt.receipt_sha256,
    evidence_digest:receipt.evidence_digest,
    result:receipt.result,
    physical_committed:physical.committed===true,
    physical_truth_verified:expectedVerification.physical_truth_verified
  };
}

module.exports={
  SCHEMA_VERSION,
  digestObject,
  patchTarget,
  authorizationReceiptVerification,
  physicalEvidenceRow,
  buildExecutionReceipt,
  verifyExecutionReceipt
};
