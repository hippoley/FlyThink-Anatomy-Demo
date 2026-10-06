"use strict";

function outcomeValue(x={}){
  return (
    1.0*Number(x.goal_completed||0)
    -0.6*Number(x.wrong_target||0)
    -0.35*Number(x.correction_needed||0)
    -0.15*Number(x.extra_actions||0)
  );
}

function adjudicateShadowRecord(record={}){
  const actual=record.actual_outcome||{};
  const current=actual.current||actual;
  const shadow=actual.shadow||null;
  if(!shadow){
    return {
      id:record.id||null,
      comparable:false,
      reason:"shadow_outcome_missing"
    };
  }
  const currentValue=outcomeValue(current);
  const shadowValue=outcomeValue(shadow);
  return {
    id:record.id||null,
    comparable:true,
    current_value:Number(currentValue.toFixed(4)),
    shadow_value:Number(shadowValue.toFixed(4)),
    realized_advantage:Number((shadowValue-currentValue).toFixed(4)),
    winner:shadowValue>currentValue?"shadow":(shadowValue<currentValue?"current":"tie"),
    disagreement:!!(record.comparison&&record.comparison.any_disagreement)
  };
}

function summarizeShadowReport(report={}){
  const rows=(report.rows||[]).map(adjudicateShadowRecord);
  const comparable=rows.filter(x=>x.comparable);
  const disagreements=comparable.filter(x=>x.disagreement);
  const shadowWins=disagreements.filter(x=>x.winner==="shadow").length;
  const currentWins=disagreements.filter(x=>x.winner==="current").length;
  const ties=disagreements.filter(x=>x.winner==="tie").length;
  const avgAdv=disagreements.length
    ?disagreements.reduce((a,x)=>a+x.realized_advantage,0)/disagreements.length
    :0;
  return {
    schema_version:"pi-home-shadow-eval-v1",
    comparable:comparable.length,
    disagreement_cases:disagreements.length,
    shadow_wins:shadowWins,
    current_wins:currentWins,
    ties,
    average_realized_advantage:Number(avgAdv.toFixed(4)),
    promotion_candidate:
      disagreements.length>=1 &&
      shadowWins>currentWins &&
      avgAdv>0,
    rows
  };
}

module.exports={outcomeValue,adjudicateShadowRecord,summarizeShadowReport};
