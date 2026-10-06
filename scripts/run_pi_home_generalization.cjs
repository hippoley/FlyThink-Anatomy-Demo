"use strict";
const fs=require("fs");
const {evaluateGeneralizationSuite}=require("./pi_home_generalization_eval.cjs");

(async()=>{
  const data=JSON.parse(fs.readFileSync("benchmarks/pi_home_generalization_suite.json","utf8"));
  const out=await evaluateGeneralizationSuite(data.cases,{
    baselinePredict:async c=>c.baseline,
    experimentalPredict:async c=>c.experimental
  });
  console.log(JSON.stringify(out,null,2));
  if(out.holdout.exact_replay_hits!==0)process.exitCode=2;
  if(out.claim.generalization_reality_delta!==true)process.exitCode=2;
})().catch(e=>{console.error(e);process.exit(1)});
