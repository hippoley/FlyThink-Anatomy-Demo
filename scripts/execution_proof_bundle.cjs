"use strict";

const {
  digestObject,
  verifyExecutionReceipt
}=require("./execution_receipt.cjs");
const {
  validateDecisionProposal,
  digestDecisionProposal
}=require("./decision_proposal_contract.cjs");
const {
  contextStateIdentity
}=require("./contextual_edge_slu_adapter.cjs");

const SCHEMA_VERSION="execution-proof-bundle.v1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function isDigest(v){return /^[0-9a-f]{64}$/.test(String(v||""))}
function bundleCore(bundle){
  const out=clone(bundle);
  delete out.bundle_sha256;
  return out;
}
function requiredObject(value,name){
  if(!value||typeof value!=="object"||Array.isArray(value)){
    throw new Error("execution_proof_bundle_"+name+"_required");
  }
}

function deriveExternalBinding(decisionProposal,internalProposal,contextualState=null){
  validateDecisionProposal(decisionProposal);
  requiredObject(internalProposal,"internal_proposal");
  const strategy=internalProposal.strategy||{};
  const digest=digestDecisionProposal(decisionProposal);
  if(strategy.source_contract!=="decision-proposal.v1")
    throw new Error("execution_proof_bundle_source_contract_mismatch");
  if(strategy.source_decision_proposal_sha256!==digest)
    throw new Error("execution_proof_bundle_decision_proposal_binding_mismatch");
  if(internalProposal.proposal_id!==decisionProposal.proposal_id)
    throw new Error("execution_proof_bundle_proposal_id_mismatch");
  if(internalProposal.task_id!==decisionProposal.task_id)
    throw new Error("execution_proof_bundle_task_id_mismatch");
  if(Number(strategy.context_revision)!==Number(decisionProposal.context_revision))
    throw new Error("execution_proof_bundle_context_revision_mismatch");
  if(strategy.context_sha256!==decisionProposal.context_sha256)
    throw new Error("execution_proof_bundle_context_digest_mismatch");
  if(contextualState){
    const contextIdentity=contextStateIdentity(contextualState);
    if(contextIdentity.context_revision!==decisionProposal.context_revision)
      throw new Error("execution_proof_bundle_context_revision_mismatch");
    if(contextIdentity.context_sha256!==decisionProposal.context_sha256)
      throw new Error("execution_proof_bundle_context_digest_mismatch");
  }
  if(Number(strategy.world_snapshot_revision)!==Number(decisionProposal.world_snapshot_revision))
    throw new Error("execution_proof_bundle_world_revision_mismatch");
  if(strategy.world_snapshot_sha256!==decisionProposal.world_snapshot_sha256)
    throw new Error("execution_proof_bundle_world_digest_mismatch");
  return {
    decision_proposal_sha256:digest,
    context_revision:decisionProposal.context_revision,
    context_sha256:decisionProposal.context_sha256,
    world_snapshot_revision:decisionProposal.world_snapshot_revision,
    world_snapshot_sha256:decisionProposal.world_snapshot_sha256
  };
}

function artifactDigests(artifacts){
  return {
    decision_proposal_sha256:digestObject(artifacts.decision_proposal),
    contextual_state_sha256:digestObject(artifacts.contextual_state),
    request_sha256:digestObject(artifacts.request),
    internal_proposal_sha256:digestObject(artifacts.internal_proposal),
    before_runtime_sha256:digestObject(artifacts.before_runtime),
    after_runtime_sha256:digestObject(artifacts.after_runtime),
    execution_receipt_sha256:digestObject(artifacts.execution_receipt)
  };
}

function deriveVerification(artifacts){
  const external=deriveExternalBinding(
    artifacts.decision_proposal,
    artifacts.internal_proposal,
    artifacts.contextual_state
  );
  const execution=verifyExecutionReceipt(
    artifacts.execution_receipt,
    {
      contextual_state:artifacts.contextual_state,
      request:artifacts.request,
      proposal:artifacts.internal_proposal,
      before_runtime:artifacts.before_runtime,
      after_runtime:artifacts.after_runtime
    }
  );
  return {
    external_binding:external,
    execution:{
      receipt_sha256:execution.receipt_sha256,
      evidence_digest:execution.evidence_digest,
      result:execution.result,
      physical_committed:execution.physical_committed,
      physical_truth_verified:execution.physical_truth_verified,
      physical_completion_verified:execution.physical_completion_verified,
      safe_closeout_verified:execution.safe_closeout_verified,
      authorization_trust_domain_key_source_verified:
        execution.authorization_trust_domain_key_source_verified===true,
      authorization_issuer_authenticated_verified:
        execution.authorization_issuer_authenticated_verified===true,
      independent_object_outcome_verified:
        execution.independent_object_outcome_verified===true
    }
  };
}

function buildExecutionProofBundle({
  decision_proposal,
  contextual_state,
  request,
  internal_proposal,
  before_runtime,
  after_runtime,
  execution_receipt
}={}){
  const artifacts={
    decision_proposal:clone(decision_proposal),
    contextual_state:clone(contextual_state),
    request:clone(request),
    internal_proposal:clone(internal_proposal),
    before_runtime:clone(before_runtime),
    after_runtime:clone(after_runtime),
    execution_receipt:clone(execution_receipt)
  };
  for(const [name,value] of Object.entries(artifacts))requiredObject(value,name);
  const bundle={
    schema_version:SCHEMA_VERSION,
    authority:{
      execution_truth:"execution-receipt.v1",
      external_proposal:"decision-proposal.v1",
      note:"The bundle binds evidence; execution truth remains owned by execution-receipt.v1."
    },
    artifacts,
    manifest:artifactDigests(artifacts),
    verification:deriveVerification(artifacts)
  };
  bundle.bundle_sha256=digestObject(bundleCore(bundle));
  return bundle;
}

function verifyExecutionProofBundle(bundle={}){
  if(!bundle||bundle.schema_version!==SCHEMA_VERSION)
    throw new Error("execution_proof_bundle_schema_invalid");
  if(!isDigest(bundle.bundle_sha256))
    throw new Error("execution_proof_bundle_digest_invalid");
  if(digestObject(bundleCore(bundle))!==bundle.bundle_sha256)
    throw new Error("execution_proof_bundle_digest_mismatch");
  requiredObject(bundle.artifacts,"artifacts");
  requiredObject(bundle.manifest,"manifest");
  requiredObject(bundle.verification,"verification");

  const required=[
    "decision_proposal",
    "contextual_state",
    "request",
    "internal_proposal",
    "before_runtime",
    "after_runtime",
    "execution_receipt"
  ];
  for(const name of required)requiredObject(bundle.artifacts[name],name);

  const expectedManifest=artifactDigests(bundle.artifacts);
  for(const [name,value] of Object.entries(expectedManifest)){
    if(!isDigest(bundle.manifest[name])||bundle.manifest[name]!==value){
      throw new Error("execution_proof_bundle_"+name+"_mismatch");
    }
  }

  if(!bundle.authority||
     bundle.authority.execution_truth!=="execution-receipt.v1"||
     bundle.authority.external_proposal!=="decision-proposal.v1"){
    throw new Error("execution_proof_bundle_authority_invalid");
  }

  const expectedVerification=deriveVerification(bundle.artifacts);
  // Additive v1 evolution: accept older stored verification blocks, but
  // recompute the current verdicts from the retained artifacts before return.
  // Additive v1 chronology matters. The immediately previous verifier had
  // issuer + independent-object claims but not the new trust-domain claim.
  // Remove fields newest-first so every retained historical generation remains
  // independently verifiable instead of accidentally skipping one shape.
  const preTrustDomainVerification=clone(expectedVerification);
  if(preTrustDomainVerification&&preTrustDomainVerification.execution){
    delete preTrustDomainVerification.execution.authorization_trust_domain_key_source_verified;
  }
  const preObjectIndependenceVerification=clone(preTrustDomainVerification);
  if(preObjectIndependenceVerification&&preObjectIndependenceVerification.execution){
    delete preObjectIndependenceVerification.execution.independent_object_outcome_verified;
  }
  const preIssuerAuthVerification=clone(preObjectIndependenceVerification);
  if(preIssuerAuthVerification&&preIssuerAuthVerification.execution){
    delete preIssuerAuthVerification.execution.authorization_issuer_authenticated_verified;
  }
  const completionOnlyVerification=clone(preIssuerAuthVerification);
  if(completionOnlyVerification&&completionOnlyVerification.execution){
    delete completionOnlyVerification.execution.safe_closeout_verified;
  }
  const legacyVerification=clone(completionOnlyVerification);
  if(legacyVerification&&legacyVerification.execution){
    delete legacyVerification.execution.physical_completion_verified;
  }
  const verificationDigest=digestObject(bundle.verification);
  const verificationMatches=
    verificationDigest===digestObject(expectedVerification)||
    verificationDigest===digestObject(preTrustDomainVerification)||
    verificationDigest===digestObject(preObjectIndependenceVerification)||
    verificationDigest===digestObject(preIssuerAuthVerification)||
    verificationDigest===digestObject(completionOnlyVerification)||
    verificationDigest===digestObject(legacyVerification);
  if(!verificationMatches)
    throw new Error("execution_proof_bundle_verification_mismatch");

  return {
    valid:true,
    bundle_sha256:bundle.bundle_sha256,
    execution_receipt_sha256:
      expectedVerification.execution.receipt_sha256,
    decision_proposal_sha256:
      expectedVerification.external_binding.decision_proposal_sha256,
    physical_committed:
      expectedVerification.execution.physical_committed,
    physical_truth_verified:
      expectedVerification.execution.physical_truth_verified,
    physical_completion_verified:
      expectedVerification.execution.physical_completion_verified,
    safe_closeout_verified:
      expectedVerification.execution.safe_closeout_verified,
    authorization_trust_domain_key_source_verified:
      expectedVerification.execution.authorization_trust_domain_key_source_verified===true,
    authorization_issuer_authenticated_verified:
      expectedVerification.execution.authorization_issuer_authenticated_verified===true,
    independent_object_outcome_verified:
      expectedVerification.execution.independent_object_outcome_verified===true,
    result:expectedVerification.execution.result
  };
}

module.exports={
  SCHEMA_VERSION,
  bundleCore,
  artifactDigests,
  deriveExternalBinding,
  buildExecutionProofBundle,
  verifyExecutionProofBundle
};
