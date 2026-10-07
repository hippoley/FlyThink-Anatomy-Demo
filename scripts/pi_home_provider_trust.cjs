"use strict";

const crypto=require("crypto");

function canonical(value){
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value&&typeof value==="object"){
    return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
  }
  return JSON.stringify(value);
}

function sha256(value){
  return "sha256:"+crypto.createHash("sha256").update(
    typeof value==="string"?value:canonical(value)
  ).digest("hex");
}

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

function verifyCalibrationCertificate(certificate={}){
  if(certificate.schema_version!=="pi-home-provider-calibration-certificate-v1"){
    return {valid:false,reason:"unsupported_calibration_certificate_schema"};
  }
  if(certificate.passed!==true){
    return {valid:false,reason:"calibration_certificate_not_passed"};
  }
  if(certificate.source_kind!=="measured"||certificate.source_kind_accepted!==true){
    return {valid:false,reason:"calibration_certificate_source_not_measured"};
  }
  if(!Array.isArray(certificate.covered_dimensions)||!certificate.covered_dimensions.length){
    return {valid:false,reason:"calibration_certificate_dimensions_missing"};
  }
  const core=clone(certificate);
  const supplied=core.calibration_digest;
  delete core.calibration_digest;
  let normalized;
  try{normalized=normalizeDigest(supplied)}
  catch(_){return {valid:false,reason:"calibration_certificate_digest_invalid"}}
  const expected=sha256(core);
  if(normalized!==expected){
    return {valid:false,reason:"calibration_certificate_digest_mismatch"};
  }
  return {valid:true,reason:"calibration_certificate_verified",certificate:clone(certificate)};
}

function certificateMatchesEntry(certificate,entry){
  const certDims=uniq(certificate.covered_dimensions);
  const allowed=uniq(entry.allowed_dimensions);
  if(certificate.provider_id!==entry.provider_id)return "certificate_provider_mismatch";
  if(certificate.scope_id!==entry.scope_id)return "certificate_scope_mismatch";
  if(!entry.allowed_evidence_levels.includes(certificate.evidence_level))return "certificate_evidence_level_mismatch";
  if(certDims.some(d=>!allowed.includes(d))||allowed.some(d=>!certDims.includes(d))){
    return "certificate_dimension_mismatch";
  }
  if(certificate.calibration_ref!==entry.calibration_ref)return "certificate_ref_mismatch";
  if(certificate.calibration_digest!==entry.calibration_digest)return "certificate_digest_entry_mismatch";
  return null;
}

function buildProviderTrustRegistry(entries=[],{certificates=[]}={}){
  const certByProvider={};
  for(const raw of certificates||[]){
    const verification=verifyCalibrationCertificate(raw);
    const providerId=raw&&raw.provider_id?String(raw.provider_id):"";
    if(!providerId)throw new Error("calibration_certificate_provider_id_required");
    if(certByProvider[providerId])throw new Error("duplicate_calibration_certificate:"+providerId);
    certByProvider[providerId]={raw:clone(raw),verification};
  }

  const out={};
  for(const raw of entries||[]){
    const entry=normalizeRegistryEntry(raw);
    if(out[entry.provider_id])throw new Error("duplicate_provider_trust_entry:"+entry.provider_id);
    const certRecord=certByProvider[entry.provider_id]||null;
    let certificate_verified=false;
    let certificate_reason="calibration_certificate_missing";
    let certificate_digest=null;
    if(certRecord){
      certificate_reason=certRecord.verification.reason;
      if(certRecord.verification.valid){
        const mismatch=certificateMatchesEntry(certRecord.raw,entry);
        if(mismatch){
          certificate_reason=mismatch;
        }else{
          certificate_verified=true;
          certificate_reason="calibration_certificate_verified_and_matched";
          certificate_digest=certRecord.raw.calibration_digest;
        }
      }
    }
    out[entry.provider_id]={
      ...entry,
      certificate_verified,
      certificate_reason,
      certificate_digest
    };
  }
  return {
    schema_version:"pi-home-provider-trust-registry-v1",
    entries:out
  };
}

function registryEntries(registry){
  if(!registry)return null;
  if(registry.schema_version!=="pi-home-provider-trust-registry-v1"){
    throw new Error("unsupported_provider_trust_registry");
  }
  return registry.entries||{};
}

function resolveProviderTrust(provider={},registry=null){
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
  if(entry.status!=="active"){
    return {...base,reason:"provider_trust_revoked",registry_entry:clone(entry)};
  }
  if(entry.certificate_verified!==true){
    return {
      ...base,
      reason:"provider_calibration_certificate_unverified",
      certificate_reason:entry.certificate_reason||null,
      registry_entry:clone(entry)
    };
  }

  const disallowed=covered.filter(d=>!entry.allowed_dimensions.includes(d));
  if(disallowed.length){
    return {
      ...base,
      reason:"provider_dimension_out_of_scope",
      out_of_scope_dimensions:disallowed,
      registry_entry:clone(entry)
    };
  }

  const evidenceLevel=String(provider.evidence_level||"unspecified");
  if(!entry.allowed_evidence_levels.includes(evidenceLevel)){
    return {
      ...base,
      reason:"provider_evidence_level_not_allowed",
      registry_entry:clone(entry)
    };
  }

  const attestation=provider.trust_attestation||{};
  if(attestation.scope_id!==entry.scope_id){
    return {...base,reason:"provider_scope_mismatch",registry_entry:clone(entry)};
  }
  if(attestation.calibration_ref!==entry.calibration_ref){
    return {...base,reason:"provider_calibration_ref_mismatch",registry_entry:clone(entry)};
  }
  let digest;
  try{digest=normalizeDigest(attestation.calibration_digest)}
  catch(_){
    return {...base,reason:"provider_calibration_digest_invalid",registry_entry:clone(entry)};
  }
  if(digest!==entry.calibration_digest){
    return {...base,reason:"provider_calibration_digest_mismatch",registry_entry:clone(entry)};
  }

  return {
    ...base,
    effective_trusted_for_promotion:true,
    reason:"registry_attestation_match",
    registry_entry:clone(entry)
  };
}

function applyResolvedTrust(provider={},registry=null){
  const resolution=resolveProviderTrust(provider,registry);
  return {
    ...clone(provider),
    claimed_trusted_for_promotion:resolution.claimed_trusted_for_promotion,
    trusted_for_promotion:resolution.effective_trusted_for_promotion,
    trust_resolution:resolution
  };
}

module.exports={
  canonical,
  sha256,
  normalizeDigest,
  normalizeRegistryEntry,
  verifyCalibrationCertificate,
  certificateMatchesEntry,
  buildProviderTrustRegistry,
  resolveProviderTrust,
  applyResolvedTrust
};
