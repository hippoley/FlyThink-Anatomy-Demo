"use strict";

const assert=require("assert");
const fs=require("fs");
const {createStructuralTransferPolicy}=require("../scripts/pi_home_structural_transfer_policy.cjs");
const {evaluateGeneralizationSuite}=require("../scripts/pi_home_generalization_eval.cjs");

(async()=>{
  const data=JSON.parse(fs.readFileSync("benchmarks/pi_home_generalization_suite.json","utf8"));
  const policy=createStructuralTransferPolicy({
    train_cases:data.train_cases,
    baselinePredict:async input=>input.baseline
  });

  assert.equal(policy.learned.rules["wrong-room-correction"].target_source_path,"references.corrected_target");
  assert.equal(policy.learned.rules["quiet-alternative"].target_source_path,"alternatives.preferred_target");
  assert.equal(policy.learned.rules["topology-opening-selection"].target_source_path,"topology.preferred_opening");

  const out=await evaluateGeneralizationSuite(data.cases,{
    baselinePredict:async c=>c.baseline,
    experimentalPredict:async c=>policy.predict({
      context:c.context,
      baseline:c.baseline
    })
  });

  assert.equal(out.seen.cases,1);
  assert.equal(out.compositional.cases,2);
  assert.equal(out.topology.cases,2);
  assert.equal(out.holdout.cases,4);
  assert.equal(out.holdout.exact_replay_hits,0);
  assert.equal(out.holdout.experimental.goal_completion_rate,1);
  assert.equal(out.holdout.experimental.wrong_target,0);
  assert.equal(out.holdout.experimental.correction_needed,0);
  assert.ok(out.holdout.delta.wrong_target_reduction>0);
  assert.ok(out.holdout.delta.goal_completion_gain>0);
  assert.equal(out.claim.generalization_reality_delta,true);

  const contaminatedPolicy={
    predict:async c=>({
      ...(await policy.predict(c)),
      replay_conditioned:true
    })
  };
  const contaminated=await evaluateGeneralizationSuite(data.cases,{
    baselinePredict:async c=>c.baseline,
    experimentalPredict:async c=>contaminatedPolicy.predict({
      context:c.context,
      baseline:c.baseline
    })
  });
  assert.equal(contaminated.claim.generalization_reality_delta,false);
  assert.equal(contaminated.claim.reason,"holdout_contaminated_by_exact_replay");

  console.log(JSON.stringify({
    ok:true,
    contract:"structural transfer improves unseen room/topology holdouts without exact replay",
    holdout_delta:out.holdout.delta
  }));
})().catch(e=>{console.error(e);process.exit(1)});
