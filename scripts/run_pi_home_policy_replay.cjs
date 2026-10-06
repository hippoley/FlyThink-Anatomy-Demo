"use strict";
const fs=require("fs");
const {evaluateReplayPolicyHarness}=require("./pi_home_policy_replay_harness.cjs");
function arg(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null}

(async()=>{
  const path=arg("--benchmark")||"benchmarks/pi_home_offline_replay.json";
  const data=JSON.parse(fs.readFileSync(path,"utf8"));
  const out=await evaluateReplayPolicyHarness(data.cases||[]);
  console.log(JSON.stringify(out,null,2));
  if(out.conditioned_cases<1)process.exitCode=2;
  if(out.delta.wrong_target_reduction<1)process.exitCode=2;
  if(out.delta.correction_reduction<1)process.exitCode=2;
  if(out.delta.extra_action_reduction<1)process.exitCode=2;
  if(out.delta.goal_completion_gain<1)process.exitCode=2;
})().catch(e=>{console.error(e);process.exit(1)});
