"use strict";

const assert=require("assert");
const {ShadowPolicyMonitor}=require("../scripts/pi_home_shadow_policy.cjs");

(async()=>{
  let currentExecuted=0;
  let shadowExecuted=0;
  const monitor=new ShadowPolicyMonitor({
    currentPredict:async input=>{
      currentExecuted++;
      return {
        decision:"EXECUTE",
        patches:[{op:"PATCH_SLOT",target:{area:"客厅",entity:"窗户",instance:"default"},slot:"opening",value:50}]
      };
    },
    shadowPredict:async input=>{
      shadowExecuted++;
      return {
        decision:"EXECUTE",
        patches:[{op:"PATCH_SLOT",target:{area:"客厅",entity:"窗户",instance:"default"},slot:"opening",value:70}]
      };
    },
    advantageEstimator:async()=>({value:0.25,preferred:"shadow"})
  });

  const chosen=await monitor.predict({turn_id:"t1",text:"有点闷"});
  assert.equal(currentExecuted,1);
  assert.equal(shadowExecuted,1);
  assert.equal(chosen.patches[0].value,50);
  assert.equal(chosen.shadow_observation.prediction.patches[0].value,70);
  assert.equal(chosen.shadow_observation.comparison.patch_disagreement,true);
  assert.equal(chosen.shadow_observation.predicted_advantage.preferred,"shadow");

  monitor.attachOutcome("t1",{goal_completed:true,wrong_target:0});
  const report=monitor.report();
  assert.equal(report.turns,1);
  assert.equal(report.disagreements,1);
  assert.equal(report.outcomes_attached,1);
  assert.equal(report.rows[0].actual_outcome.goal_completed,true);

  console.log(JSON.stringify({
    ok:true,
    contract:"shadow policy can disagree and be evaluated without replacing current policy output"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
