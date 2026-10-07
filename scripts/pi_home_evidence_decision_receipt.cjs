"use strict";

const {canonical,sha256}=require("./pi_home_provider_trust.cjs");
const {
  verifyTrustRegistrySnapshot,
  verifyTrustRegistryLineage,
  verifyTrustRegistrySnapshotFreshAt
}=require("./pi_home_provider_trust_lineage.cjs");

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
function digestObject(value){return sha256(canonical(value))}
function providerEvidenceDigests(providerResults=[]){
  const seen=new Set();
  return (providerResults||[]).map(result=>{
    const id=requireText(result&&result.id,"provider_evidence_id");
    if(seen.has(id))throw new Error("duplicate_provider_evidence_id:"+id);
    seen.add(id);
    return {id,digest:digestObject(result)};
  }).sort((a,b)=>a.id.localeCompare(b.id));
}
function adjudicationTrustedRegistryDigests(adjudication={}){
  const out=new Set();
  const byDimension=adjudication.by_dimension||{};
  for(const dimension of Object.values(byDimension)){
    for(const provider of dimension.providers||[]){
      if(provider.trusted_for_promotion!==true)continue;
      const digest=
        provider.trust_resolution&&provider.trust_resolution.registry_digest ||
        provider.registry_digest ||
        null;
      if(digest)out.add(String(digest));
    }
  }
  const coverageProviders=
    adjudication.coverage&&adjudication.coverage.providers||[];
  for(const provider of coverageProviders){
    if(provider.trusted_for_promotion!==true)continue;
    const digest=
      provider.trust_resolution&&provider.trust_resolution.registry_digest ||
      provider.registry_digest ||
      null;
    if(digest)out.add(String(digest));
  }
  return [...out].sort();
}
function adjudicationTrustedEvaluationTimes(adjudication={}){
  const out=new Set();
  const byDimension=adjudication.by_dimension||{};
  for(const dimension of Object.values(byDimension)){
    for(const provider of dimension.providers||[]){
      if(provider.trusted_for_promotion!==true)continue;
      const value=provider.trust_resolution&&provider.trust_resolution.evaluation_time;
      if(value)out.add(normalizeInstant(value,"trusted_provider_evaluation_time"));
    }
  }
  const coverageProviders=
    adjudication.coverage&&adjudication.coverage.providers||[];
  for(const provider of coverageProviders){
    if(provider.trusted_for_promotion!==true)continue;
    const value=provider.trust_resolution&&provider.trust_resolution.evaluation_time;
    if(value)out.add(normalizeInstant(value,"trusted_provider_evaluation_time"));
  }
  return [...out].sort();
}

function receiptCore(receipt){
  return {
    schema_version:"pi-home-evidence-decision-receipt-v1",
    decision_id:receipt.decision_id,
    evaluated_at:receipt.evaluated_at,
    actor:receipt.actor,
    learned_candidate_digest:receipt.learned_candidate_digest,
    adjudication_digest:receipt.adjudication_digest,
    provider_evidence_digests:receipt.provider_evidence_digests,
    trust_snapshot:{
      revision:receipt.trust_snapshot.revision,
      registry_digest:receipt.trust_snapshot.registry_digest,
      snapshot_digest:receipt.trust_snapshot.snapshot_digest
    },
    trust_lineage_head:receipt.trust_lineage_head?{
      revision:receipt.trust_lineage_head.revision,
      snapshot_digest:receipt.trust_lineage_head.snapshot_digest
    }:null,
    trusted_for_generalization_claim:receipt.trusted_for_generalization_claim===true,
    device_execution_authorized:false
  };
}
function buildEvidenceDecisionReceipt({
  decision_id,
  evaluated_at,
  actor,
  learned_candidate,
  adjudication,
  provider_results=[],
  trust_snapshot,
  trust_lineage=null
}={}){
  if(learned_candidate==null)throw new Error("learned_candidate_required");
  if(!adjudication||typeof adjudication!=="object")throw new Error("adjudication_required");
  const verified=verifyTrustRegistrySnapshot(trust_snapshot);
  const normalizedEvaluatedAt=normalizeInstant(evaluated_at,"decision_evaluated_at");
  const trustedDigests=adjudicationTrustedRegistryDigests(adjudication);
  const trustedTimes=adjudicationTrustedEvaluationTimes(adjudication);
  if(trustedDigests.length>1){
    throw new Error("multiple_trusted_registry_snapshots_in_adjudication");
  }
  if(trustedDigests.length===1&&trustedDigests[0]!==verified.registry_digest){
    throw new Error("adjudication_trust_snapshot_mismatch");
  }
  const trustedClaim=adjudication.trusted_for_generalization_claim===true;
  let lineageHead=null;
  if(trustedClaim){
    if(!Array.isArray(trust_lineage)||!trust_lineage.length){
      throw new Error("trusted_adjudication_trust_lineage_required");
    }
    verifyTrustRegistryLineage(trust_lineage);
    const freshness=verifyTrustRegistrySnapshotFreshAt(
      trust_snapshot,
      trust_lineage,
      normalizedEvaluatedAt
    );
    lineageHead={
      revision:freshness.lineage_head_revision,
      snapshot_digest:freshness.lineage_head_snapshot_digest
    };
  }
  if(trustedClaim&&trustedDigests.length!==1){
    throw new Error("trusted_adjudication_registry_digest_required");
  }
  if(trustedClaim&&trustedTimes.length!==1){
    throw new Error("trusted_adjudication_evaluation_time_required");
  }
  if(trustedTimes.length===1&&trustedTimes[0]!==normalizedEvaluatedAt){
    throw new Error("trusted_adjudication_evaluation_time_mismatch");
  }

  const receipt={
    schema_version:"pi-home-evidence-decision-receipt-v1",
    decision_id:requireText(decision_id,"decision_id"),
    evaluated_at:normalizedEvaluatedAt,
    actor:requireText(actor,"decision_actor"),
    learned_candidate_digest:digestObject(learned_candidate),
    adjudication_digest:digestObject(adjudication),
    provider_evidence_digests:providerEvidenceDigests(provider_results),
    trust_snapshot:{
      revision:verified.revision,
      registry_digest:verified.registry_digest,
      snapshot_digest:verified.snapshot_digest
    },
    trust_lineage_head:lineageHead,
    trusted_for_generalization_claim:trustedClaim,
    device_execution_authorized:false
  };
  receipt.receipt_digest=digestObject(receiptCore(receipt));
  return receipt;
}
function verifyEvidenceDecisionReceipt(receipt={},{
  learned_candidate,
  adjudication,
  provider_results=[],
  trust_snapshot,
  trust_lineage=null
}={}){
  if(receipt.schema_version!=="pi-home-evidence-decision-receipt-v1"){
    throw new Error("evidence_decision_receipt_schema_invalid");
  }
  const expectedReceipt=digestObject(receiptCore(receipt));
  if(receipt.receipt_digest!==expectedReceipt){
    throw new Error("evidence_decision_receipt_digest_mismatch");
  }
  const verified=verifyTrustRegistrySnapshot(trust_snapshot);
  if(receipt.trust_snapshot.revision!==verified.revision){
    throw new Error("evidence_decision_receipt_revision_mismatch");
  }
  if(receipt.trust_snapshot.registry_digest!==verified.registry_digest){
    throw new Error("evidence_decision_receipt_registry_digest_mismatch");
  }
  if(receipt.trust_snapshot.snapshot_digest!==verified.snapshot_digest){
    throw new Error("evidence_decision_receipt_snapshot_digest_mismatch");
  }
  if(receipt.learned_candidate_digest!==digestObject(learned_candidate)){
    throw new Error("evidence_decision_receipt_candidate_mismatch");
  }
  if(receipt.adjudication_digest!==digestObject(adjudication)){
    throw new Error("evidence_decision_receipt_adjudication_mismatch");
  }
  const evidence=providerEvidenceDigests(provider_results);
  if(canonical(receipt.provider_evidence_digests)!==canonical(evidence)){
    throw new Error("evidence_decision_receipt_provider_evidence_mismatch");
  }
  const trustedDigests=adjudicationTrustedRegistryDigests(adjudication);
  const trustedTimes=adjudicationTrustedEvaluationTimes(adjudication);
  if(trustedDigests.length>1){
    throw new Error("multiple_trusted_registry_snapshots_in_adjudication");
  }
  if(trustedDigests.length===1&&trustedDigests[0]!==verified.registry_digest){
    throw new Error("adjudication_trust_snapshot_mismatch");
  }
  if(receipt.trusted_for_generalization_claim===true){
    if(!Array.isArray(trust_lineage)||!trust_lineage.length){
      throw new Error("trusted_adjudication_trust_lineage_required");
    }
    verifyTrustRegistryLineage(trust_lineage);
    const freshness=verifyTrustRegistrySnapshotFreshAt(
      trust_snapshot,
      trust_lineage,
      receipt.evaluated_at
    );
    if(!receipt.trust_lineage_head){
      throw new Error("evidence_decision_receipt_lineage_head_required");
    }
    const anchor=trust_lineage.find(
      x=>x.revision===receipt.trust_lineage_head.revision
    );
    if(!anchor){
      throw new Error("evidence_decision_receipt_lineage_anchor_missing");
    }
    if(anchor.snapshot_digest!==receipt.trust_lineage_head.snapshot_digest){
      throw new Error("evidence_decision_receipt_lineage_anchor_digest_mismatch");
    }
    if(anchor.revision<receipt.trust_snapshot.revision){
      throw new Error("evidence_decision_receipt_lineage_anchor_before_snapshot");
    }
    verifyTrustRegistryLineage(
      trust_lineage.slice(0,anchor.revision)
    );
    if(freshness.snapshot_digest!==receipt.trust_snapshot.snapshot_digest){
      throw new Error("evidence_decision_receipt_snapshot_not_fresh_at_evaluation_time");
    }
    if(trustedTimes.length!==1){
      throw new Error("trusted_adjudication_evaluation_time_required");
    }
  }
  if(trustedTimes.length===1&&trustedTimes[0]!==receipt.evaluated_at){
    throw new Error("trusted_adjudication_evaluation_time_mismatch");
  }
  if(receipt.trusted_for_generalization_claim!==(
    adjudication.trusted_for_generalization_claim===true
  )){
    throw new Error("evidence_decision_receipt_claim_mismatch");
  }
  if(receipt.device_execution_authorized!==false){
    throw new Error("evidence_decision_receipt_must_not_authorize_device_execution");
  }
  return {
    valid:true,
    decision_id:receipt.decision_id,
    receipt_digest:receipt.receipt_digest,
    registry_digest:verified.registry_digest,
    snapshot_digest:verified.snapshot_digest
  };
}

module.exports={
  digestObject,
  providerEvidenceDigests,
  adjudicationTrustedRegistryDigests,
  adjudicationTrustedEvaluationTimes,
  buildEvidenceDecisionReceipt,
  verifyEvidenceDecisionReceipt
};
