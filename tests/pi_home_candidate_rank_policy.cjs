"use strict";

const assert=require("assert");
const fs=require("fs");
const {createCandidateRankPolicy}=require("../scripts/pi_home_candidate_rank_policy.cjs");
const {evaluatePolicyOnCases}=require("../scripts/pi_home_generalization_eval.cjs");

(async()=>{
  const data=JSON.parse(fs.readFileSync("benchmarks/pi_home_candidate_generalization.json","utf8"));
  const policy=createCandidateRankPolicy({
    train_cases:data.train_cases,
    baselinePredict:async input=>input.baseline
  });

  assert.equal(policy.learned.rules["quiet-ventilation"].features.noise_cost.direction,"min");
  assert.equal(policy.learned.rules["rain-safe-opening"].features.rain_exposure.direction,"min");
  assert.equal(policy.learned.rules["rain-safe-opening"].features.leeward_score.direction,"max");

  const out=await evaluatePolicyOnCases(data.cases,{
    baselinePredict:async c=>c.baseline,
    experimentalPredict:async c=>policy.predict({context:c.context,baseline:c.baseline})
  });
  assert.equal(out.cases,2);
  assert.equal(out.exact_replay_hits,0);
  assert.equal(out.experimental.goal_completion_rate,1);
  assert.equal(out.experimental.wrong_target,0);
  assert.equal(out.experimental.correction_needed,0);
  assert.ok(out.delta.goal_completion_gain>0);
  assert.ok(out.delta.wrong_target_reduction>0);

  console.log(JSON.stringify({
    ok:true,
    contract:"candidate feature preferences transfer to unseen rooms/topologies without gold or exact replay",
    delta:out.delta
  }));
})().catch(e=>{console.error(e);process.exit(1)});
