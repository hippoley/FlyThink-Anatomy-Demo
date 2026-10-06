"use strict";
const fs=require("fs");
const {createStructuralTransferPolicy}=require("./pi_home_structural_transfer_policy.cjs");
const {evaluateGeneralizationSuite}=require("./pi_home_generalization_eval.cjs");

(async()=>{
  const data=JSON.parse(fs.readFileSync("benchmarks/pi_home_generalization_suite.json","utf8"));
  const policy=createStructuralTransferPolicy({
    train_cases:data.train_cases||[],
    baselinePredict:async input=>input.baseline
  });
  const out=await evaluateGeneralizationSuite(data.cases||[],{
    baselinePredict:async c=>c.baseline,
    experimentalPredict:async c=>policy.predict({
      context:c.context,
      baseline:c.baseline
    })
  });
  const result={
    ...out,
    learned_rules:policy.learned
  };
  console.log(JSON.stringify(result,null,2));
  if(result.holdout.exact_replay_hits!==0)process.exitCode=2;
  if(result.claim.generalization_reality_delta!==true)process.exitCode=2;
  if(Object.keys(result.learned_rules.rules||{}).length<3)process.exitCode=2;
})().catch(e=>{console.error(e);process.exit(1)});
