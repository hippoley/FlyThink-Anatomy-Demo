"use strict";

const assert=require("assert");
const fs=require("fs");
const {evaluateGeneralizationSuite}=require("../scripts/pi_home_generalization_eval.cjs");

(async()=>{
  const data=JSON.parse(fs.readFileSync("benchmarks/pi_home_generalization_suite.json","utf8"));
  const out=await evaluateGeneralizationSuite(data.cases,{
    baselinePredict:async c=>c.baseline,
    experimentalPredict:async c=>c.experimental
  });

  assert.equal(out.schema_version,"pi-home-generalization-eval-v1");
  assert.equal(out.seen.cases,1);
  assert.equal(out.compositional.cases,2);
  assert.equal(out.topology.cases,2);
  assert.equal(out.holdout.cases,4);
  assert.equal(out.holdout.exact_replay_hits,0);
  assert.ok(out.holdout.delta.wrong_target_reduction>0);
  assert.ok(out.holdout.delta.correction_reduction>0);
  assert.ok(out.holdout.delta.goal_completion_gain>0);
  assert.equal(out.claim.generalization_reality_delta,true);
  assert.equal(out.claim.reason,"unseen_holdout_improved_without_exact_replay");

  const contaminated=JSON.parse(JSON.stringify(data.cases));
  contaminated.find(x=>x.split==="topology").experimental.replay_conditioned=true;
  const bad=await evaluateGeneralizationSuite(contaminated,{
    baselinePredict:async c=>c.baseline,
    experimentalPredict:async c=>c.experimental
  });
  assert.equal(bad.claim.generalization_reality_delta,false);
  assert.equal(bad.claim.reason,"holdout_contaminated_by_exact_replay");

  console.log(JSON.stringify({
    ok:true,
    contract:"generalization requires unseen compositional/topology improvement with zero exact replay hits",
    holdout_delta:out.holdout.delta
  }));
})().catch(e=>{console.error(e);process.exit(1)});
