"use strict";

const {buildPreferencePairs}=require("./pi_home_preference_pairs.cjs");
const {createReplayConditionedPolicy}=require("./pi_home_replay_policy.cjs");
const {decisionMetrics,aggregate,delta}=require("./pi_home_offline_replay_eval.cjs");

async function evaluateReplayPolicyHarness(cases=[]){
  const preferenceDataset=buildPreferencePairs(cases);
  const policy=createReplayConditionedPolicy({
    preferenceDataset,
    baselinePredict:async input=>input.baseline
  });

  const rows=[];
  for(const c of cases||[]){
    const baseline=await policy.predict({
      context:c.context||{},
      replay_context:c.context||{},
      baseline:c.baseline||{}
    });
    const replayConditioned=baseline.replay_conditioned
      ?baseline
      :await policy.predict({
        context:c.context||{},
        replay_context:c.context||{},
        baseline:c.baseline||{}
      });
    const baseMetrics=decisionMetrics(c.baseline||{},c.gold||{});
    const replayMetrics=decisionMetrics(replayConditioned,c.gold||{});
    rows.push({
      id:c.id,
      replay_conditioned:!!replayConditioned.replay_conditioned,
      baseline:baseMetrics,
      replay:replayMetrics,
      pair_id:replayConditioned.replay_evidence&&replayConditioned.replay_evidence.pair_id||null
    });
  }

  const b=aggregate(rows.map(x=>x.baseline));
  const r=aggregate(rows.map(x=>x.replay));
  return {
    schema_version:"pi-home-policy-replay-harness-v1",
    memory_size:policy.memory_size,
    cases:rows.length,
    conditioned_cases:rows.filter(x=>x.replay_conditioned).length,
    baseline:b,
    replay:r,
    delta:delta(b,r),
    rows
  };
}

module.exports={evaluateReplayPolicyHarness};
