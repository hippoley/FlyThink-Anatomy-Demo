"use strict";
const fs=require("fs");
const {createCandidateRankPolicy}=require("./pi_home_candidate_rank_policy.cjs");
const {evaluatePolicyOnCases}=require("./pi_home_generalization_eval.cjs");

(async()=>{
  const data=JSON.parse(fs.readFileSync("benchmarks/pi_home_candidate_generalization.json","utf8"));
  const policy=createCandidateRankPolicy({
    train_cases:data.train_cases,
    baselinePredict:async input=>input.baseline
  });
  const out=await evaluatePolicyOnCases(data.cases,{
    baselinePredict:async c=>c.baseline,
    experimentalPredict:async c=>policy.predict({context:c.context,baseline:c.baseline})
  });
  const result={schema_version:"pi-home-candidate-generalization-eval-v1",learned:policy.learned,...out};
  console.log(JSON.stringify(result,null,2));
  if(result.exact_replay_hits!==0)process.exitCode=2;
  if(result.experimental.goal_completion_rate!==1)process.exitCode=2;
  if(result.experimental.wrong_target!==0)process.exitCode=2;
})().catch(e=>{console.error(e);process.exit(1)});
