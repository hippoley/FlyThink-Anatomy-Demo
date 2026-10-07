"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function uniq(xs){return [...new Set((xs||[]).map(String))].sort()}

function normalizeDimensionSpec(spec={}){
  const direction=String(spec.direction||"min");
  if(!["min","max"].includes(direction))throw new Error("unsupported_dimension_direction:"+direction);
  const scores=spec.scores||{};
  const entries=Object.entries(scores);
  if(!entries.length)throw new Error("dimension_scores_required");
  for(const [label,value] of entries){
    if(!label)throw new Error("candidate_label_required");
    if(!Number.isFinite(Number(value)))throw new Error("candidate_score_must_be_numeric:"+label);
  }
  return {
    direction,
    scores:Object.fromEntries(entries.map(([k,v])=>[String(k),Number(v)]))
  };
}

function assessProviderCalibration(result={},dimensionNames=[]){
  const requested=result.trusted_for_promotion===true;
  const calibration=result.calibration||null;
  if(!requested){
    return {
      requested_trust:false,
      effective_trust:false,
      reason:"provider_not_marked_trusted",
      calibration:clone(calibration)
    };
  }
  if(!calibration||calibration.status!=="validated"){
    return {
      requested_trust:true,
      effective_trust:false,
      reason:"validated_calibration_required",
      calibration:clone(calibration)
    };
  }
  if(!calibration.validation_id){
    return {
      requested_trust:true,
      effective_trust:false,
      reason:"calibration_validation_id_required",
      calibration:clone(calibration)
    };
  }
  const scope=uniq(calibration.covered_dimensions||[]);
  const missing=dimensionNames.filter(x=>!scope.includes(x));
  if(missing.length){
    return {
      requested_trust:true,
      effective_trust:false,
      reason:"calibration_scope_incomplete",
      missing_calibration_dimensions:missing,
      calibration:clone(calibration)
    };
  }
  return {
    requested_trust:true,
    effective_trust:true,
    reason:"validated_calibration_matches_dimensions",
    calibration:clone(calibration)
  };
}

function normalizeEvidenceResult(result={}){
  if(!result.id)throw new Error("evidence_result_id_required");
  const dimensions={};
  for(const [name,spec] of Object.entries(result.dimensions||{})){
    dimensions[String(name)]=normalizeDimensionSpec(spec);
  }
  const dimensionNames=Object.keys(dimensions);
  if(!dimensionNames.length)throw new Error("evidence_result_dimensions_required");
  const trust=assessProviderCalibration(result,dimensionNames);
  return {
    id:String(result.id),
    kind:String(result.kind||"unknown"),
    evidence_level:String(result.evidence_level||"unspecified"),
    requested_trusted_for_promotion:result.trusted_for_promotion===true,
    trusted_for_promotion:trust.effective_trust===true,
    trust_assessment:trust,
    provenance:clone(result.provenance||null),
    dimensions
  };
}

function candidateLabelsFromResults(results=[]){
  const labels=new Set();
  for(const r of results){
    for(const spec of Object.values(r.dimensions)){
      for(const label of Object.keys(spec.scores))labels.add(label);
    }
  }
  return [...labels].sort();
}

function normalizeAcrossCandidates(values,direction){
  const nums=Object.values(values);
  const min=Math.min(...nums),max=Math.max(...nums);
  const out={};
  for(const [label,value] of Object.entries(values)){
    const raw=max===min?1:(value-min)/(max-min);
    out[label]=direction==="min"?1-raw:raw;
  }
  return out;
}

function fuseCandidateEvidence({
  required_dimensions=[],
  provider_results=[],
  dimension_weights={},
  learned_candidate_label=null
}={}){
  const required=uniq(required_dimensions);
  const providers=(provider_results||[]).map(normalizeEvidenceResult);
  const labels=candidateLabelsFromResults(providers);
  if(!labels.length){
    return {
      schema_version:"pi-home-multiphysics-fusion-v1",
      decision:"BLOCKED",
      reason:"candidate_scores_missing",
      trusted_for_generalization_claim:false
    };
  }

  const byDimension={};
  const missing=[];
  const incomplete=[];
  for(const dimension of required){
    const covering=providers.filter(p=>p.dimensions[dimension]);
    if(!covering.length){
      missing.push(dimension);
      continue;
    }
    const complete=covering.filter(p=>
      labels.every(label=>Object.prototype.hasOwnProperty.call(p.dimensions[dimension].scores,label))
    );
    if(!complete.length){
      incomplete.push(dimension);
      continue;
    }

    // Prefer trusted evidence when available; otherwise use all complete screening evidence.
    const trusted=complete.filter(p=>p.trusted_for_promotion);
    const selected=trusted.length?trusted:complete;
    const perProvider=selected.map(p=>({
      provider:p,
      normalized:normalizeAcrossCandidates(
        p.dimensions[dimension].scores,
        p.dimensions[dimension].direction
      )
    }));
    const aggregate={};
    for(const label of labels){
      aggregate[label]=perProvider.reduce((a,x)=>a+x.normalized[label],0)/perProvider.length;
    }
    byDimension[dimension]={
      dimension,
      trusted:selected.every(x=>x.trusted_for_promotion),
      providers:selected.map(x=>({
        id:x.id,
        kind:x.kind,
        evidence_level:x.evidence_level,
        trusted_for_promotion:x.trusted_for_promotion
      })),
      normalized_candidate_scores:aggregate
    };
  }

  if(missing.length||incomplete.length){
    return {
      schema_version:"pi-home-multiphysics-fusion-v1",
      decision:"NOT_ADJUDICABLE",
      reason:missing.length?"required_evidence_dimensions_missing":"candidate_score_coverage_incomplete",
      required_dimensions:required,
      candidate_labels:labels,
      missing_dimensions:missing,
      incomplete_dimensions:incomplete,
      by_dimension:byDimension,
      trusted_for_generalization_claim:false
    };
  }

  const totalWeight=required.reduce((a,d)=>a+Number(dimension_weights[d]??1),0)||1;
  const combined={};
  for(const label of labels){
    combined[label]=required.reduce((a,d)=>{
      const w=Number(dimension_weights[d]??1);
      return a+byDimension[d].normalized_candidate_scores[label]*w;
    },0)/totalWeight;
  }
  const ranking=Object.entries(combined)
    .map(([label,score])=>({label,score:Number(score.toFixed(6))}))
    .sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label));
  const winner=ranking[0];
  const trustedCoverageComplete=required.every(d=>byDimension[d].trusted===true);
  const aligned=learned_candidate_label?winner.label===learned_candidate_label:null;

  let decision;
  if(trustedCoverageComplete){
    decision=aligned===false?"MISALIGNED":"ALIGNED";
  }else{
    decision=aligned===false?"SCREENING_MISALIGNED":"SCREENING_ALIGNED";
  }

  return {
    schema_version:"pi-home-multiphysics-fusion-v1",
    decision,
    reason:trustedCoverageComplete
      ?"complete_trusted_multiphysics_evidence"
      :"complete_but_untrusted_multiphysics_evidence",
    required_dimensions:required,
    candidate_labels:labels,
    by_dimension:byDimension,
    ranking,
    winner,
    learned_candidate_label:learned_candidate_label||null,
    semantic_physics_aligned:aligned,
    trusted_coverage_complete:trustedCoverageComplete,
    trusted_for_generalization_claim:trustedCoverageComplete&&aligned===true
  };
}

function rainIngressScreeningProvider(caseDef={}){
  const candidates=caseDef&&caseDef.context&&caseDef.context.candidates||[];
  const scores={};
  candidates.forEach((candidate,index)=>{
    const features=candidate.features||{};
    if(!Number.isFinite(Number(features.rain_exposure))){
      throw new Error("rain_exposure_feature_required:"+String(index));
    }
    scores["candidate-"+String(index+1)]=Number(features.rain_exposure);
  });
  return {
    id:"rain-ingress-screening-v1",
    kind:"heuristic-screening",
    evidence_level:"feature-derived-screening",
    trusted_for_promotion:false,
    provenance:{source:"candidate.features.rain_exposure"},
    dimensions:{
      rain_ingress:{direction:"min",scores}
    }
  };
}

function acousticScreeningProvider(caseDef={}){
  const candidates=caseDef&&caseDef.context&&caseDef.context.candidates||[];
  const scores={};
  candidates.forEach((candidate,index)=>{
    const features=candidate.features||{};
    if(!Number.isFinite(Number(features.noise_cost))){
      throw new Error("noise_cost_feature_required:"+String(index));
    }
    scores["candidate-"+String(index+1)]=Number(features.noise_cost);
  });
  return {
    id:"acoustic-screening-v1",
    kind:"heuristic-screening",
    evidence_level:"feature-derived-screening",
    trusted_for_promotion:false,
    provenance:{source:"candidate.features.noise_cost"},
    dimensions:{
      noise:{direction:"min",scores}
    }
  };
}

module.exports={
  normalizeEvidenceResult,
  assessProviderCalibration,
  normalizeDimensionSpec,
  normalizeAcrossCandidates,
  fuseCandidateEvidence,
  rainIngressScreeningProvider,
  acousticScreeningProvider
};
