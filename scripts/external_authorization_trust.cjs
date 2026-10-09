"use strict";

const crypto=require("crypto");
const {canonical}=require("./execution_reasoning_contract.cjs");
const {deviceKey}=require("./whole_home_patch_contract.cjs");

const VERDICT_SCHEMA="flythink-external-authorization-trust-verdict.v1";
const EVIDENCE_SCHEMA="flythink-external-authorization-trust-evidence.v1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function digestObject(v){
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
}
function isDigest(v){return /^[0-9a-f]{64}$/.test(String(v||""))}

function patchTarget(patch){
  if(!patch)return null;
  if(patch.op==="REPLACE_TARGET")return patch.to||null;
  return patch.target||null;
}

function buildExternalAuthorizationTrustBinding({
  authorized_actions=[],
  authorization_receipt=null,
  completion_criteria=[],
  world_snapshot_revision=null,
  world_snapshot_sha256=null
}={}){
  if(!authorization_receipt||typeof authorization_receipt!=="object")
    throw new Error("authorization_trust_receipt_required");
  if(!Array.isArray(authorized_actions)||authorized_actions.length===0)
    throw new Error("authorization_trust_actions_required");
  if(!Array.isArray(completion_criteria))
    throw new Error("authorization_trust_completion_criteria_invalid");
  if(!Number.isInteger(world_snapshot_revision)||world_snapshot_revision<0)
    throw new Error("authorization_trust_world_revision_required");
  if(!isDigest(world_snapshot_sha256))
    throw new Error("authorization_trust_world_sha256_required");

  const targets=authorized_actions.map((patch,index)=>{
    const target=patchTarget(patch);
    if(!target)throw new Error("authorization_trust_target_required:"+String(index));
    try{return deviceKey(target)}
    catch{throw new Error("authorization_trust_target_invalid:"+String(index))}
  });

  return {
    schema_version:"flythink-external-authorization-binding.v1",
    patch_digest:String(authorization_receipt.patch_digest||""),
    runtime_registry_digest:String(authorization_receipt.registry_digest||""),
    world_snapshot_revision:String(world_snapshot_revision),
    world_snapshot_sha256:String(world_snapshot_sha256),
    completion_criteria_sha256:digestObject(completion_criteria),
    execution_target_digest:digestObject(targets)
  };
}

function validateExternalAuthorizationTrustVerdict(verdict,binding,{
  require_issuer=false
}={}){
  if(!verdict||typeof verdict!=="object"||Array.isArray(verdict))
    throw new Error("external_authorization_trust_verdict_required");
  if(verdict.schema_version!==VERDICT_SCHEMA)
    throw new Error("external_authorization_trust_verdict_schema_invalid");

  for(const field of [
    "provider","provider_revision","transaction_id","trust_anchor_source"
  ]){
    if(typeof verdict[field]!=="string"||!verdict[field])
      throw new Error("external_authorization_trust_"+field+"_required");
  }
  for(const field of [
    "token_sha256","trust_anchor_sha256","binding_sha256"
  ]){
    if(!isDigest(verdict[field]))
      throw new Error("external_authorization_trust_"+field+"_invalid");
  }

  const expectedBindingSha=digestObject(binding);
  if(verdict.binding_sha256!==expectedBindingSha)
    throw new Error("external_authorization_trust_binding_mismatch");

  if(verdict.cryptographic_validation_verified!==true)
    throw new Error("external_authorization_crypto_unverified");
  if(verdict.trust_domain_key_source_verified!==true)
    throw new Error("external_authorization_trust_domain_unverified");
  if(verdict.required_claims_verified!==true)
    throw new Error("external_authorization_required_claims_unverified");
  if(verdict.flythink_profile_binding_verified!==true)
    throw new Error("external_authorization_profile_binding_unverified");
  if(verdict.ready_for_canonical_execution!==true)
    throw new Error("external_authorization_not_ready");
  if(
    require_issuer===true&&
    verdict.issuer_authenticated_verified!==true
  )throw new Error("external_authorization_issuer_unverified");

  if(typeof verdict.offline_reverifiable!=="boolean")
    throw new Error("external_authorization_offline_reverifiable_required");

  return {
    schema_version:EVIDENCE_SCHEMA,
    provider:verdict.provider,
    provider_revision:verdict.provider_revision,
    transaction_id:verdict.transaction_id,
    token_sha256:verdict.token_sha256,
    trust_anchor_sha256:verdict.trust_anchor_sha256,
    trust_anchor_source:verdict.trust_anchor_source,
    binding:clone(binding),
    binding_sha256:expectedBindingSha,
    runtime_enforced:true,
    trust_domain_key_source_verified_at_runtime:true,
    issuer_authenticated_at_runtime:
      verdict.issuer_authenticated_verified===true,
    offline_reverifiable:verdict.offline_reverifiable===true
  };
}

function verifyRetainedExternalAuthorizationEvidence(evidence,expectedBinding=null){
  if(evidence==null)return {
    bound:false,
    runtime_enforced_recorded:false,
    offline_reverifiable:false
  };
  if(!evidence||typeof evidence!=="object"||Array.isArray(evidence))
    throw new Error("external_authorization_evidence_invalid");
  if(evidence.schema_version!==EVIDENCE_SCHEMA)
    throw new Error("external_authorization_evidence_schema_invalid");
  if(typeof evidence.provider!=="string"||!evidence.provider)
    throw new Error("external_authorization_evidence_provider_required");
  if(typeof evidence.provider_revision!=="string"||!evidence.provider_revision)
    throw new Error("external_authorization_evidence_provider_revision_required");
  if(typeof evidence.transaction_id!=="string"||!evidence.transaction_id)
    throw new Error("external_authorization_evidence_transaction_id_required");
  for(const field of ["token_sha256","trust_anchor_sha256","binding_sha256"]){
    if(!isDigest(evidence[field]))
      throw new Error("external_authorization_evidence_"+field+"_invalid");
  }
  if(!evidence.binding||typeof evidence.binding!=="object"||Array.isArray(evidence.binding))
    throw new Error("external_authorization_evidence_binding_required");
  if(digestObject(evidence.binding)!==evidence.binding_sha256)
    throw new Error("external_authorization_evidence_binding_digest_mismatch");
  if(expectedBinding&&digestObject(expectedBinding)!==evidence.binding_sha256)
    throw new Error("external_authorization_evidence_expected_binding_mismatch");
  if(evidence.runtime_enforced!==true)
    throw new Error("external_authorization_evidence_runtime_enforced_required");
  if(evidence.trust_domain_key_source_verified_at_runtime!==true)
    throw new Error("external_authorization_evidence_runtime_trust_required");
  if(typeof evidence.issuer_authenticated_at_runtime!=="boolean")
    throw new Error("external_authorization_evidence_issuer_flag_required");
  if(typeof evidence.offline_reverifiable!=="boolean")
    throw new Error("external_authorization_evidence_offline_flag_required");

  return {
    bound:true,
    runtime_enforced_recorded:true,
    offline_reverifiable:evidence.offline_reverifiable===true
  };
}

module.exports={
  VERDICT_SCHEMA,
  EVIDENCE_SCHEMA,
  digestObject,
  buildExternalAuthorizationTrustBinding,
  validateExternalAuthorizationTrustVerdict,
  verifyRetainedExternalAuthorizationEvidence
};
