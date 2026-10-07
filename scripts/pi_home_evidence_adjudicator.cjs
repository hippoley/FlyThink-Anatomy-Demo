"use strict";

const {
  fuseCandidateEvidence,
  normalizeEvidenceResult
}=require("./pi_home_multiphysics_evidence.cjs");

function uniq(xs){return [...new Set((xs||[]).map(String))].sort()}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function normalizeProvider(provider={}){
  if(!provider.id)throw new Error("evidence_provider_id_required");
  const dimensions=uniq(provider.covered_dimensions);
  if(!dimensions.length)throw new Error("evidence_provider_dimensions_required");
  return {
    id:String(provider.id),
    kind:String(provider.kind||"unknown"),
    covered_dimensions:dimensions,
    evidence_level:String(provider.evidence_level||"unspecified"),
    trusted_for_promotion:provider.trusted_for_promotion===true,
    provenance:clone(provider.provenance||null)
  };
}

function buildEvidenceCoverage({required_dimensions=[],providers=[]}={}){
  const required=uniq(required_dimensions);
  const normalized=(providers||[]).map(normalizeProvider);
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
        trusted_for_promotion:p.trusted_for_promotion
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
  physical_candidate_comparison_available=false
}={}){
  const coverage=buildEvidenceCoverage({required_dimensions,providers});
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

function adjudicateCandidateEvidence({
  required_dimensions=[],
  provider_results=[],
  learned_candidate_label=null,
  dimension_weights={}
}={}){
  const fusion=fuseCandidateEvidence({
    required_dimensions,
    provider_results,
    learned_candidate_label,
    dimension_weights
  });

  if(fusion.decision==="BLOCKED"||fusion.decision==="NOT_ADJUDICABLE"){
    return {
      schema_version:"pi-home-candidate-evidence-adjudication-v1",
      ...fusion,
      trusted_for_generalization_claim:false
    };
  }

  const normalizedResults=(provider_results||[]).map(normalizeEvidenceResult);
  const providers=normalizedResults.map(result=>({
    id:result.id,
    kind:result.kind,
    covered_dimensions:Object.keys(result.dimensions||{}),
    evidence_level:result.evidence_level,
    trusted_for_promotion:result.trusted_for_promotion===true,
    provenance:result.provenance||null
  }));
  const coverage=buildEvidenceCoverage({required_dimensions,providers});

  return {
    schema_version:"pi-home-candidate-evidence-adjudication-v1",
    ...fusion,
    coverage,
    trusted_for_generalization_claim:
      fusion.trusted_for_generalization_claim===true &&
      coverage.trusted_coverage_complete===true
  };
}

module.exports={
  normalizeProvider,
  buildEvidenceCoverage,
  adjudicateEvidence,
  adjudicateCandidateEvidence
};
