"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function canonical(v){
  if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
  if(v&&typeof v==="object"){
    return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  }
  return JSON.stringify(v);
}

function topSelectionTarget(prediction={}){
  const ranking=prediction.candidate_ranking||[];
  if(ranking.length&&ranking[0].target)return clone(ranking[0].target);
  const patches=prediction.patches||[];
  const p=patches.find(x=>x&&x.target);
  return p&&p.target?clone(p.target):null;
}

function physicalWinnerTargets(tournament={}){
  const winner=tournament&&tournament.winner;
  const patches=winner&&winner.outcome&&winner.outcome.strategy&&winner.outcome.strategy.patches||[];
  return patches.filter(x=>x&&x.target).map(x=>clone(x.target));
}

function validateSemanticPhysicsAlignment({prediction,tournament}={}){
  const semanticTarget=topSelectionTarget(prediction||{});
  if(!semanticTarget){
    return {
      schema_version:"pi-home-semantic-physics-alignment-v1",
      decision:"BLOCKED",
      reason:"semantic_target_missing",
      counterfactual_confirmed:false
    };
  }
  const winner=tournament&&tournament.winner;
  if(!winner){
    return {
      schema_version:"pi-home-semantic-physics-alignment-v1",
      decision:"BLOCKED",
      reason:"physical_winner_missing",
      semantic_target:semanticTarget,
      counterfactual_confirmed:false
    };
  }
  const outcome=winner.outcome||{};
  if(outcome.provenance!=="counterfactual_simulation"||outcome.trusted_for_promotion!==true){
    return {
      schema_version:"pi-home-semantic-physics-alignment-v1",
      decision:"BLOCKED",
      reason:"physical_winner_not_trusted",
      semantic_target:semanticTarget,
      physical_winner_label:winner.label||null,
      counterfactual_confirmed:false
    };
  }
  if(outcome.strategy&&outcome.strategy.complete_physics_coverage===false){
    return {
      schema_version:"pi-home-semantic-physics-alignment-v1",
      decision:"BLOCKED",
      reason:"physical_winner_incomplete_coverage",
      semantic_target:semanticTarget,
      physical_winner_label:winner.label||null,
      counterfactual_confirmed:false
    };
  }
  const physicalTargets=physicalWinnerTargets(tournament);
  const aligned=physicalTargets.some(x=>canonical(x)===canonical(semanticTarget));
  return {
    schema_version:"pi-home-semantic-physics-alignment-v1",
    decision:aligned?"COUNTERFACTUAL_CONFIRMED":"SEMANTIC_PHYSICS_DISAGREEMENT",
    reason:aligned?"semantic_target_present_in_physical_winner":"semantic_target_not_in_physical_winner",
    semantic_target:semanticTarget,
    physical_winner_label:winner.label||null,
    physical_targets:physicalTargets,
    counterfactual_confirmed:aligned,
    trusted_for_generalization_claim:aligned
  };
}

module.exports={
  validateSemanticPhysicsAlignment,
  topSelectionTarget,
  physicalWinnerTargets,
  canonical
};
