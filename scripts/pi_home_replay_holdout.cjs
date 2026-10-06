"use strict";

const {buildPreferencePairs}=require("./pi_home_preference_pairs.cjs");
const {createReplayConditionedPolicy}=require("./pi_home_replay_policy.cjs");
const {decisionMetrics,aggregate,delta}=require("./pi_home_offline_replay_eval.cjs");

async function evaluateReplayHoldout({train_cases=[],holdout_cases=[]}={}){
  const preferences=buildPreferencePairs(train_cases);
  const policy=createReplayConditionedPolicy({
    preferenceDataset:preferences,
    baselinePredict:async input=>input.baseline
  });

  const rows=[];
  for(const c of holdout_cases||[]){
    const prediction=await policy.predict({
      context:c.context||{},
      replay_context:c.context||{},
      baseline:c.baseline||{}
    });
    const baselineMetrics=decisionMetrics(c.baseline||{},c.gold||{});
    const replayMetrics=decisionMetrics(prediction,c.gold||{});
    rows.push({
      id:c.id,
      conditioned:!!prediction.replay_conditioned,
      baseline:baselineMetrics,
      replay:replayMetrics
    });
  }
  const baseline=aggregate(rows.map(x=>x.baseline));
  const replay=aggregate(rows.map(x=>x.replay));
  const d=delta(baseline,replay);
  return {
    schema_version:"pi-home-replay-holdout-v1",
    train_pairs:preferences.pairs.length,
    holdout_cases:rows.length,
    conditioned_holdout:rows.filter(x=>x.conditioned).length,
    baseline,
    replay,
    delta:d,
    generalization_claim_supported:
      rows.length>0 &&
      rows.some(x=>x.conditioned) &&
      (
        d.wrong_target_reduction>0 ||
        d.correction_reduction>0 ||
        d.extra_action_reduction>0 ||
        d.goal_completion_gain>0
      ),
    rows
  };
}

module.exports={evaluateReplayHoldout};
