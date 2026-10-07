"use strict";

const {applyResolvedTrust}=require("./pi_home_provider_trust.cjs");

function uniq(xs){return [...new Set((xs||[]).map(String))].sort()}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function normalizeProvider(provider={},trust_registry=null){
  if(!provider.id)throw new Error("evidence_provider_id_required");
  const dimensions=uniq(provider.covered_dimensions);
  if(!dimensions.length)throw new Error("evidence_provider_dimensions_required");
  const trusted=applyResolvedTrust({
    ...provider,
    id:String(provider.id),
    covered_dimensions:dimensions
  },trust_registry);
  return {
    id:String(provider.id),
    kind:String(provider.kind||"unknown"),
    covered_dimensions:dimensions,
    evidence_level:String(provider.evidence_level||"unspecified"),
    claimed_trusted_for_promotion:trusted.claimed_trusted_for_promotion===true,
    trusted_for_promotion:trusted.trusted_for_promotion===true,
    trust_resolution:clone(trusted.trust_resolution||null),
    provenance:clone(provider.provenance||null)
  };
}

function buildEvidenceCoverage({required_dimensions=[],providers=[],trust_registry=null}={}){
  const required=uniq(required_dimensions);
  const normalized=(providers||[]).map(x=>normalizeProvider(x,trust_registry));
  const byDimension={};
  for(const dimension of required){
    const covering=normalized.filter(p=>p.covered_dimensions.includes(dimension));
    byDimension[dimension]={
      dimension,
      covered:covering.length>0,
      trusted:covering.some(p=>p.trusted_for_promotion===true),
      providers:covering.map(p=>({
        id:p.id,
        kind:p.kind,
        evidence_level:p.evidence_level,
        claimed_trusted_for_promotion:p.claimed_trusted_for_promotion,
        trusted_for_promotion:p.trusted_for_promotion,
        trust_resolution:clone(p.trust_resolution||null)
      }))
    };
  }
  const missing=required.filter(d=>!byDimension[d].covered);
  const untrusted=required.filter(d=>byDimension[d].covered&&!byDimension[d].trusted);
  return {
    required_dimensions:required,
    providers:normalized,
    by_dimension:byDimension,
    missing_dimensions:missing,
    untrusted_dimensions:untrusted,
    coverage_complete:missing.length===0,
    trusted_coverage_complete:missing.length===0&&untrusted.length===0
  };
}

function adjudicateEvidence({
  required_dimensions=[],
  providers=[],
  raw_target_match=null,
  physical_candidate_comparison_available=false,
  trust_registry=null
}={}){
  const coverage=buildEvidenceCoverage({required_dimensions,providers,trust_registry});
  if(!physical_candidate_comparison_available){
    return {
      schema_version:"pi-home-evidence-adjudication-v1",
      decision:"BLOCKED",
      reason:"candidate_comparison_missing",
      coverage,
      raw_target_match,
      trusted_for_generalization_claim:false
    };
  }
  if(!coverage.coverage_complete){
    return {
      schema_version:"pi-home-evidence-adjudication-v1",
      decision:"NOT_ADJUDICABLE",
      reason:"required_evidence_dimensions_missing",
      coverage,
      raw_target_match,
      semantic_physics_aligned:null,
      trusted_for_generalization_claim:false
    };
  }

  const aligned=raw_target_match===true;
  const trusted=coverage.trusted_coverage_complete&&aligned;
  return {
    schema_version:"pi-home-evidence-adjudication-v1",
    decision:aligned?"ALIGNED":"MISALIGNED",
    reason:aligned?"candidate_target_matches_complete_evidence_winner":"candidate_target_differs_from_complete_evidence_winner",
    coverage,
    raw_target_match:raw_target_match===true,
    semantic_physics_aligned:aligned,
    trusted_for_generalization_claim:trusted
  };
}

module.exports={
  normalizeProvider,
  buildEvidenceCoverage,
  adjudicateEvidence
};
