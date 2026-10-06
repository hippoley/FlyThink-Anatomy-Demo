"use strict";

const {decisionMetrics}=require("./pi_home_offline_replay_eval.cjs");

function metricValue(metrics={}){
  return (
    1.0*Number(metrics.goal_completed||0)
    -0.6*Number(metrics.wrong_target||0)
    -0.35*Number(metrics.correction_needed||0)
    -0.15*Number(metrics.extra_actions||0)
  );
}

function advantageFromCase(c={}){
  if(!c.gold)throw new Error("advantage_gold_required");
  const b=decisionMetrics(c.baseline||{},c.gold||{});
  const r=decisionMetrics(c.replay||{},c.gold||{});
  const baselineValue=metricValue(b);
  const replayValue=metricValue(r);
  return {
    schema_version:"pi-home-advantage-v1",
    id:c.id,
    baseline_metrics:b,
    replay_metrics:r,
    baseline_value:Number(baselineValue.toFixed(4)),
    replay_value:Number(replayValue.toFixed(4)),
    advantage:Number((replayValue-baselineValue).toFixed(4)),
    preferred:(replayValue-baselineValue)>0?"replay":((replayValue-baselineValue)<0?"baseline":"tie"),
    evidence:c.evidence||null
  };
}

function buildAdvantageDataset(cases=[]){
  const rows=(cases||[]).map(advantageFromCase);
  return {
    schema_version:"pi-home-advantage-dataset-v1",
    rows,
    positive_advantage:rows.filter(x=>x.advantage>0).length,
    nonpositive_advantage:rows.filter(x=>x.advantage<=0).length
  };
}

module.exports={metricValue,advantageFromCase,buildAdvantageDataset};
