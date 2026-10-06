"use strict";

const {outcomeValue,provenanceAssessment}=require("./pi_home_shadow_eval.cjs");
const {strategyOutcomeToShadowMetrics}=require("./pi_home_shadow_strategy_counterfactual.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function buildStrategyPromotionEvidence({
  tournament,
  current_outcome,
  goal,
  min_advantage=0.1
}={}){
  if(!tournament||tournament.schema_version!=="pi-home-strategy-tournament-v1"){
    throw new Error("strategy_tournament_required");
  }
  const currentAssessment=provenanceAssessment(current_outcome);
  if(!currentAssessment.valid){
    return {
      schema_version:"pi-home-strategy-promotion-evidence-v1",
      decision:"BLOCKED",
      reason:"current_outcome_not_trusted",
      current_provenance_assessment:currentAssessment,
      tournament_request_id:tournament.request_id||null
    };
  }

  const winner=tournament.winner;
  if(!winner){
    return {
      schema_version:"pi-home-strategy-promotion-evidence-v1",
      decision:"KEEP_CURRENT",
      reason:"no_eligible_counterfactual_candidate",
      tournament_request_id:tournament.request_id||null,
      blocked_candidates:clone(tournament.ranking&&tournament.ranking.blocked||[])
    };
  }

  const shadowOutcome=strategyOutcomeToShadowMetrics(winner.outcome,goal||{});
  const shadowAssessment=provenanceAssessment(shadowOutcome);
  if(!shadowAssessment.valid){
    return {
      schema_version:"pi-home-strategy-promotion-evidence-v1",
      decision:"KEEP_CURRENT",
      reason:shadowAssessment.reason,
      tournament_request_id:tournament.request_id||null,
      winner_label:winner.label,
      shadow_provenance_assessment:shadowAssessment
    };
  }

  const currentValue=outcomeValue(current_outcome);
  const shadowValue=outcomeValue(shadowOutcome);
  const advantage=shadowValue-currentValue;
  const candidate=advantage>Number(min_advantage);

  return {
    schema_version:"pi-home-strategy-promotion-evidence-v1",
    decision:candidate?"SHADOW_PROMOTION_CANDIDATE":"KEEP_CURRENT",
    reason:candidate?"trusted_counterfactual_advantage":"advantage_below_threshold",
    tournament_request_id:tournament.request_id||null,
    winner_label:winner.label,
    winner_score:winner.score,
    current_outcome:clone(current_outcome),
    shadow_outcome:clone(shadowOutcome),
    current_value:Number(currentValue.toFixed(4)),
    shadow_value:Number(shadowValue.toFixed(4)),
    estimated_advantage:Number(advantage.toFixed(4)),
    min_advantage:Number(min_advantage),
    ranking_summary:{
      eligible:(tournament.ranking&&tournament.ranking.ranked||[]).map(x=>({
        label:x.label,
        score:x.score,
        objectives:clone(x.objectives||[])
      })),
      blocked:(tournament.ranking&&tournament.ranking.blocked||[]).map(x=>({
        label:x.label,
        blocked_reason:x.blocked_reason,
        missing_objective:x.missing_objective||null
      }))
    },
    execution_authorized:false
  };
}

module.exports={buildStrategyPromotionEvidence};
