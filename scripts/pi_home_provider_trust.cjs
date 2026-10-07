"use strict";

function uniq(xs){return [...new Set((xs||[]).map(String))].sort()}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function requireText(value,name){
  if(typeof value!=="string"||!value.trim())throw new Error(name+"_required");
  return value.trim();
}

function normalizeDigest(value){
  const digest=requireText(value,"calibration_digest").toLowerCase();
  if(!/^sha256:[0-9a-f]{64}$/.test(digest)){
    throw new Error("calibration_digest_invalid");
  }
  return digest;
}

function normalizeIsoInstant(value,name){
  const text=requireText(value,name);
  const ms=Date.parse(text);
  if(!Number.isFinite(ms))throw new Error(name+"_invalid");
  return new Date(ms).toISOString();
}

function normalizeRegistryEntry(entry={}){
  const provider_id=requireText(entry.provider_id,"provider_id");
  const status=String(entry.status||"active");
  if(!["active","revoked"].includes(status))throw new Error("provider_trust_status_invalid");
  const allowed_dimensions=uniq(entry.allowed_dimensions);
  if(!allowed_dimensions.length)throw new Error("provider_trust_dimensions_required");
  const allowed_evidence_levels=uniq(entry.allowed_evidence_levels);
  if(!allowed_evidence_levels.length)throw new Error("provider_trust_evidence_levels_required");
  return {
    provider_id,
    status,
    scope_id:requireText(entry.scope_id,"provider_trust_scope_id"),
    allowed_dimensions,
    allowed_evidence_levels,
    calibration_ref:requireText(entry.calibration_ref,"calibration_ref"),
    calibration_digest:normalizeDigest(entry.calibration_digest),
    approved_by:requireText(entry.approved_by,"provider_trust_approved_by"),
    metadata:clone(entry.metadata||null)
  };
}

function normalizeTimeBoundRegistryEntry(entry={}){
  const base=normalizeRegistryEntry(entry);
  const not_before=normalizeIsoInstant(entry.not_before,"provider_trust_not_before");
  const expires_at=normalizeIsoInstant(entry.expires_at,"provider_trust_expires_at");
  const reviewed_at=normalizeIsoInstant(entry.reviewed_at,"provider_trust_reviewed_at");
  const review_due_at=normalizeIsoInstant(entry.review_due_at,"provider_trust_review_due_at");
  if(Date.parse(expires_at)<=Date.parse(not_before)){
    throw new Error("provider_trust_expiry_must_follow_not_before");
  }
  if(Date.parse(review_due_at)<=Date.parse(reviewed_at)){
    throw new Error("provider_trust_review_due_must_follow_reviewed_at");
  }
  if(Date.parse(reviewed_at)>Date.parse(not_before)){
    throw new Error("provider_trust_review_must_not_follow_activation");
  }
  if(Date.parse(review_due_at)<=Date.parse(not_before)){
    throw new Error("provider_trust_review_due_must_follow_activation");
  }
  return {
    ...base,
    not_before,
    expires_at,
    reviewed_at,
    review_due_at,
    lifecycle_metadata:clone(entry.lifecycle_metadata||null)
  };
}

function buildProviderTrustRegistry(entries=[]){
  const out={};
  for(const raw of entries||[]){
    const entry=normalizeRegistryEntry(raw);
    if(out[entry.provider_id])throw new Error("duplicate_provider_trust_entry:"+entry.provider_id);
    out[entry.provider_id]=entry;
  }
  return {
    schema_version:"pi-home-provider-trust-registry-v1",
    entries:out
  };
}

function buildProviderTrustRegistryV2(entries=[]){
  const out={};
  for(const raw of entries||[]){
    const entry=normalizeTimeBoundRegistryEntry(raw);
    if(out[entry.provider_id])throw new Error("duplicate_provider_trust_entry:"+entry.provider_id);
    out[entry.provider_id]=entry;
  }
  return {
    schema_version:"pi-home-provider-trust-registry-v2",
    entries:out
  };
}

function registryEntries(registry){
  if(!registry)return null;
  if(!["pi-home-provider-trust-registry-v1","pi-home-provider-trust-registry-v2"].includes(registry.schema_version)){
    throw new Error("unsupported_provider_trust_registry");
  }
  return registry.entries||{};
}

function resolveEvaluationTime(value){
  if(value==null)return new Date().toISOString();
  return normalizeIsoInstant(value,"provider_trust_evaluation_time");
}

function resolveProviderTrust(provider={},registry=null,{at=null}={}){
  const claimed=provider.trusted_for_promotion===true;
  const covered=uniq(
    provider.covered_dimensions||
    Object.keys(provider.dimensions||{})
  );
  const base={
    claimed_trusted_for_promotion:claimed,
    effective_trusted_for_promotion:false,
    provider_id:provider.id?String(provider.id):null,
    reason:null,
    registry_entry:null
  };

  if(!claimed)return {...base,reason:"provider_did_not_claim_trust"};
  if(!provider.id)return {...base,reason:"provider_id_missing"};

  const entries=registryEntries(registry);
  if(!entries)return {...base,reason:"trust_registry_missing"};
  const entry=entries[String(provider.id)];
  if(!entry)return {...base,reason:"provider_not_registered"};
  const lifecycleEvaluationTime=
    registry&&registry.schema_version==="pi-home-provider-trust-registry-v2"
      ?resolveEvaluationTime(at)
      :null;
  const withTime=payload=>lifecycleEvaluationTime
    ?{...payload,evaluation_time:lifecycleEvaluationTime}
    :payload;
  if(entry.status!=="active"){
    return withTime({...base,reason:"provider_trust_revoked",registry_entry:clone(entry)});
  }

  if(registry&&registry.schema_version==="pi-home-provider-trust-registry-v2"){
    const evaluation_time=lifecycleEvaluationTime;
    const now=Date.parse(evaluation_time);
    if(now<Date.parse(entry.not_before)){
      return {...base,reason:"provider_trust_not_yet_valid",evaluation_time,registry_entry:clone(entry)};
    }
    if(now>=Date.parse(entry.expires_at)){
      return {...base,reason:"provider_trust_expired",evaluation_time,registry_entry:clone(entry)};
    }
    if(now<Date.parse(entry.reviewed_at)){
      return {...base,reason:"provider_trust_review_in_future",evaluation_time,registry_entry:clone(entry)};
    }
    if(now>=Date.parse(entry.review_due_at)){
      return {...base,reason:"provider_trust_review_overdue",evaluation_time,registry_entry:clone(entry)};
    }
  }

  const disallowed=covered.filter(d=>!entry.allowed_dimensions.includes(d));
  if(disallowed.length){
    return {
      ...base,
      reason:"provider_dimension_out_of_scope",
      out_of_scope_dimensions:disallowed,
      registry_entry:clone(entry)
    });
  }

  const evidenceLevel=String(provider.evidence_level||"unspecified");
  if(!entry.allowed_evidence_levels.includes(evidenceLevel)){
    return withTime({
      ...base,
      reason:"provider_evidence_level_not_allowed",
      registry_entry:clone(entry)
    });
  }

  const attestation=provider.trust_attestation||{};
  if(attestation.scope_id!==entry.scope_id){
    return withTime({...base,reason:"provider_scope_mismatch",registry_entry:clone(entry)});
  }
  if(attestation.calibration_ref!==entry.calibration_ref){
    return withTime({...base,reason:"provider_calibration_ref_mismatch",registry_entry:clone(entry)});
  }
  let digest;
  try{digest=normalizeDigest(attestation.calibration_digest)}
  catch(_){
    return withTime({...base,reason:"provider_calibration_digest_invalid",registry_entry:clone(entry)});
  }
  if(digest!==entry.calibration_digest){
    return withTime({...base,reason:"provider_calibration_digest_mismatch",registry_entry:clone(entry)});
  }

  return withTime({
    ...base,
    effective_trusted_for_promotion:true,
    reason:"registry_attestation_match",
    registry_entry:clone(entry)
  });
}

function applyResolvedTrust(provider={},registry=null,options={}){
  const resolution=resolveProviderTrust(provider,registry,options);
  return {
    ...clone(provider),
    claimed_trusted_for_promotion:resolution.claimed_trusted_for_promotion,
    trusted_for_promotion:resolution.effective_trusted_for_promotion,
    trust_resolution:resolution
  };
}

module.exports={
  normalizeDigest,
  normalizeIsoInstant,
  normalizeRegistryEntry,
  normalizeTimeBoundRegistryEntry,
  buildProviderTrustRegistry,
  buildProviderTrustRegistryV2,
  resolveProviderTrust,
  applyResolvedTrust
};
