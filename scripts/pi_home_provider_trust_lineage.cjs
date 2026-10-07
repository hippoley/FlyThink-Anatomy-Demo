"use strict";

const {
  canonical,
  sha256,
  buildProviderTrustRegistryV2,
  verifyProviderTrustRegistry
}=require("./pi_home_provider_trust.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function requireText(v,name){
  if(typeof v!=="string"||!v.trim())throw new Error(name+"_required");
  return v.trim();
}
function normalizeInstant(v,name){
  const text=requireText(v,name);
  const ms=Date.parse(text);
  if(!Number.isFinite(ms))throw new Error(name+"_invalid");
  return new Date(ms).toISOString();
}
function registryEntriesArray(registry){
  return Object.values(registry&&registry.entries||{}).map(clone);
}
function snapshotCore(snapshot){
  return {
    schema_version:"pi-home-provider-trust-snapshot-v1",
    revision:snapshot.revision,
    previous_registry_digest:snapshot.previous_registry_digest||null,
    changed_at:snapshot.changed_at,
    changed_by:snapshot.changed_by,
    change_reason:snapshot.change_reason,
    change_id:snapshot.change_id,
    registry_digest:snapshot.registry.registry_digest
  };
}
function snapshotDigest(snapshot){
  return sha256(canonical(snapshotCore(snapshot)));
}
function verifyTrustRegistrySnapshot(snapshot={}){
  if(snapshot.schema_version!=="pi-home-provider-trust-snapshot-v1"){
    throw new Error("provider_trust_snapshot_schema_invalid");
  }
  if(!Number.isInteger(snapshot.revision)||snapshot.revision<1){
    throw new Error("provider_trust_snapshot_revision_invalid");
  }
  const registryVerification=verifyProviderTrustRegistry(snapshot.registry||{});
  if(!registryVerification.valid){
    throw new Error("provider_trust_snapshot_registry_invalid:"+registryVerification.reason);
  }
  const expected=snapshotDigest(snapshot);
  if(snapshot.snapshot_digest!==expected){
    throw new Error("provider_trust_snapshot_digest_mismatch");
  }
  return {
    valid:true,
    revision:snapshot.revision,
    registry_digest:snapshot.registry.registry_digest,
    snapshot_digest:snapshot.snapshot_digest
  };
}
function createTrustRegistrySnapshot(entries=[],{
  changed_at,
  changed_by,
  change_reason,
  change_id
}={}){
  const registry=buildProviderTrustRegistryV2(entries);
  const snapshot={
    schema_version:"pi-home-provider-trust-snapshot-v1",
    revision:1,
    previous_registry_digest:null,
    changed_at:normalizeInstant(changed_at,"provider_trust_changed_at"),
    changed_by:requireText(changed_by,"provider_trust_changed_by"),
    change_reason:requireText(change_reason,"provider_trust_change_reason"),
    change_id:requireText(change_id,"provider_trust_change_id"),
    registry
  };
  snapshot.snapshot_digest=snapshotDigest(snapshot);
  verifyTrustRegistrySnapshot(snapshot);
  return snapshot;
}
function evolveTrustRegistrySnapshot(previous,entries=[],{
  changed_at,
  changed_by,
  change_reason,
  change_id
}={}){
  verifyTrustRegistrySnapshot(previous);
  const nextTime=normalizeInstant(changed_at,"provider_trust_changed_at");
  if(Date.parse(nextTime)<Date.parse(previous.changed_at)){
    throw new Error("provider_trust_lineage_time_regression");
  }
  const registry=buildProviderTrustRegistryV2(entries);
  const snapshot={
    schema_version:"pi-home-provider-trust-snapshot-v1",
    revision:previous.revision+1,
    previous_registry_digest:previous.registry.registry_digest,
    changed_at:nextTime,
    changed_by:requireText(changed_by,"provider_trust_changed_by"),
    change_reason:requireText(change_reason,"provider_trust_change_reason"),
    change_id:requireText(change_id,"provider_trust_change_id"),
    registry
  };
  snapshot.snapshot_digest=snapshotDigest(snapshot);
  verifyTrustRegistrySnapshot(snapshot);
  return snapshot;
}
function verifyTrustRegistryLineage(snapshots=[]){
  if(!Array.isArray(snapshots)||!snapshots.length){
    throw new Error("provider_trust_lineage_required");
  }
  const seenChanges=new Set();
  for(let i=0;i<snapshots.length;i++){
    const current=snapshots[i];
    verifyTrustRegistrySnapshot(current);
    if(seenChanges.has(current.change_id)){
      throw new Error("provider_trust_duplicate_change_id:"+current.change_id);
    }
    seenChanges.add(current.change_id);
    if(current.revision!==i+1){
      throw new Error("provider_trust_lineage_revision_gap");
    }
    if(i===0){
      if(current.previous_registry_digest!==null){
        throw new Error("provider_trust_lineage_root_previous_digest_must_be_null");
      }
      continue;
    }
    const previous=snapshots[i-1];
    if(current.previous_registry_digest!==previous.registry.registry_digest){
      throw new Error("provider_trust_lineage_previous_digest_mismatch");
    }
    if(Date.parse(current.changed_at)<Date.parse(previous.changed_at)){
      throw new Error("provider_trust_lineage_time_regression");
    }
  }
  return {
    valid:true,
    revisions:snapshots.length,
    head_revision:snapshots[snapshots.length-1].revision,
    head_registry_digest:snapshots[snapshots.length-1].registry.registry_digest,
    head_snapshot_digest:snapshots[snapshots.length-1].snapshot_digest
  };
}
function revokeProvider(previous,providerId,{
  changed_at,
  changed_by,
  reason,
  change_id
}={}){
  verifyTrustRegistrySnapshot(previous);
  const id=requireText(providerId,"provider_id");
  const entries=registryEntriesArray(previous.registry);
  const index=entries.findIndex(x=>x.provider_id===id);
  if(index<0)throw new Error("provider_trust_provider_not_found:"+id);
  entries[index]={
    ...entries[index],
    status:"revoked",
    lifecycle_metadata:{
      ...(entries[index].lifecycle_metadata||{}),
      revoked_at:normalizeInstant(changed_at,"provider_trust_changed_at"),
      revoked_by:requireText(changed_by,"provider_trust_changed_by"),
      revoked_reason:requireText(reason,"provider_trust_revocation_reason")
    }
  };
  return evolveTrustRegistrySnapshot(previous,entries,{
    changed_at,
    changed_by,
    change_reason:"revoke:"+requireText(reason,"provider_trust_revocation_reason"),
    change_id
  });
}
function renewProvider(previous,providerId,{
  expires_at,
  reviewed_at,
  review_due_at,
  changed_at,
  changed_by,
  reason,
  change_id
}={}){
  verifyTrustRegistrySnapshot(previous);
  const id=requireText(providerId,"provider_id");
  const entries=registryEntriesArray(previous.registry);
  const index=entries.findIndex(x=>x.provider_id===id);
  if(index<0)throw new Error("provider_trust_provider_not_found:"+id);
  if(entries[index].status!=="active")throw new Error("provider_trust_renew_requires_active_provider");
  entries[index]={
    ...entries[index],
    expires_at:normalizeInstant(expires_at,"provider_trust_expires_at"),
    reviewed_at:normalizeInstant(reviewed_at,"provider_trust_reviewed_at"),
    review_due_at:normalizeInstant(review_due_at,"provider_trust_review_due_at"),
    lifecycle_metadata:{
      ...(entries[index].lifecycle_metadata||{}),
      renewed_at:normalizeInstant(changed_at,"provider_trust_changed_at"),
      renewed_by:requireText(changed_by,"provider_trust_changed_by"),
      renewal_reason:requireText(reason,"provider_trust_renewal_reason")
    }
  };
  return evolveTrustRegistrySnapshot(previous,entries,{
    changed_at,
    changed_by,
    change_reason:"renew:"+requireText(reason,"provider_trust_renewal_reason"),
    change_id
  });
}

module.exports={
  createTrustRegistrySnapshot,
  evolveTrustRegistrySnapshot,
  verifyTrustRegistrySnapshot,
  verifyTrustRegistryLineage,
  revokeProvider,
  renewProvider,
  snapshotDigest
};
