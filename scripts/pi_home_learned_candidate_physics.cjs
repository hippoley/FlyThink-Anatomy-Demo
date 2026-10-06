"use strict";

const {simulatablePhysicalPatch}=require("./airtrajectory_strategy_counterfactual_adapter.cjs");
const {runStrategyTournament}=require("./pi_home_strategy_tournament.cjs");
const {validateSemanticPhysicsAlignment}=require("./pi_home_generalization_counterfactual.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function canonical(v){
  if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
  if(v&&typeof v==="object"){
    return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  }
  return JSON.stringify(v);
}
function targetKey(t){return canonical(t||null)}

function candidatePatch(candidate){
  if(!candidate||!candidate.target||!candidate.action)return null;
  return {
    ...clone(candidate.action),
    target:clone(candidate.target)
  };
}

function materializeLearnedSelection(caseDef,learnedRow){
  const predicted=learnedRow&&learnedRow.predicted;
  if(!predicted)throw new Error("learned_prediction_target_required");
  const candidates=caseDef&&caseDef.context&&caseDef.context.candidates||[];
  const candidate=candidates.find(x=>targetKey(x.target)===targetKey(predicted));
  if(!candidate)throw new Error("learned_prediction_not_in_candidate_set");
  const patch=candidatePatch(candidate);
  if(!patch)throw new Error("candidate_action_missing");
  return {
    target:clone(predicted),
    patch,
    candidate:clone(candidate)
  };
}

function buildCandidateSetStrategies(caseDef){
  const candidates=caseDef&&caseDef.context&&caseDef.context.candidates||[];
  const physics=caseDef&&caseDef.physics||{};
  const opening_map=physics.opening_map||{};
  const actuator_map=physics.actuator_map||{};
  const eligible=[];
  const unsupported=[];
  candidates.forEach((candidate,index)=>{
    const patch=candidatePatch(candidate);
    if(!patch){
      unsupported.push({
        index,
        target:clone(candidate&&candidate.target||null),
        reason:"candidate_action_missing"
      });
      return;
    }
    if(!simulatablePhysicalPatch(patch,{opening_map,actuator_map})){
      unsupported.push({
        index,
        target:clone(candidate.target),
        patch,
        reason:"candidate_not_mapped_to_airtrajectory_physics"
      });
      return;
    }
    eligible.push({
      label:"candidate-"+String(index+1),
      target:clone(candidate.target),
      patches:[patch]
    });
  });
  return {
    total:candidates.length,
    eligible,
    unsupported,
    candidate_set_complete:candidates.length>0&&unsupported.length===0
  };
}

async function evaluateLearnedCandidatePhysics({
  case_def,
  learned_row,
  adapter,
  constraints=[],
  objectives=[],
  horizon_minutes=30,
  request_id=""
}={}){
  if(!case_def)throw new Error("candidate_case_required");
  if(!adapter)throw new Error("strategy_adapter_required");
  const selected=materializeLearnedSelection(case_def,learned_row);
  const set=buildCandidateSetStrategies(case_def);
  if(!set.eligible.length){
    return {
      schema_version:"pi-home-learned-candidate-physics-v1",
      case_id:case_def.id||null,
      selected,
      candidate_set:set,
      decision:"BLOCKED",
      reason:"no_physically_simulatable_candidates",
      counterfactual_confirmed:false,
      trusted_for_generalization_claim:false
    };
  }

  const tournament=await runStrategyTournament({
    adapter,
    candidates:set.eligible.map(x=>({label:x.label,patches:x.patches})),
    origin:case_def.physics&&case_def.physics.origin,
    constraints,
    objectives,
    horizon_minutes,
    request_id
  });

  const targetByLabel=Object.fromEntries(set.eligible.map(x=>[x.label,x.target]));
  if(tournament.winner){
    const label=tournament.winner.label;
    const target=targetByLabel[label];
    tournament.winner.outcome.strategy=tournament.winner.outcome.strategy||{};
    tournament.winner.outcome.strategy.patches=tournament.winner.outcome.strategy.patches||[
      {
        ...clone(set.eligible.find(x=>x.label===label).patches[0]),
        target:clone(target)
      }
    ];
  }

  if(!set.candidate_set_complete){
    return {
      schema_version:"pi-home-learned-candidate-physics-v1",
      case_id:case_def.id||null,
      selected,
      candidate_set:set,
      tournament,
      decision:"BLOCKED",
      reason:"candidate_set_incomplete_physics_coverage",
      counterfactual_confirmed:false,
      trusted_for_generalization_claim:false
    };
  }

  const prediction={
    candidate_ranking:(learned_row.ranking||[]).map(x=>({
      target:clone(x.target),
      score:x.score
    })),
    patches:[selected.patch],
    replay_conditioned:false,
    learned_checkpoint:true
  };
  const alignment=validateSemanticPhysicsAlignment({prediction,tournament});
  return {
    schema_version:"pi-home-learned-candidate-physics-v1",
    case_id:case_def.id||null,
    selected,
    candidate_set:set,
    tournament,
    alignment,
    decision:alignment.decision,
    reason:alignment.reason,
    counterfactual_confirmed:alignment.counterfactual_confirmed===true,
    trusted_for_generalization_claim:alignment.trusted_for_generalization_claim===true
  };
}

module.exports={
  candidatePatch,
  materializeLearnedSelection,
  buildCandidateSetStrategies,
  evaluateLearnedCandidatePhysics
};
