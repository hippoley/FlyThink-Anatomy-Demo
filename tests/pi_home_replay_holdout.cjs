"use strict";

const assert=require("assert");
const {evaluateReplayHoldout}=require("../scripts/pi_home_replay_holdout.cjs");

(async()=>{
  const train=[
    {
      id:"train-kitchen",
      context:{room:"厨房",signal:"闷",weather:"rain"},
      gold:{expected_targets:[{area:"客厅",entity:"窗户",instance:"default"}],expected_action_count:1},
      baseline:{goal_completed:false,patches:[{target:{area:"厨房",entity:"窗户",instance:"default"}}]},
      replay:{goal_completed:true,patches:[{target:{area:"客厅",entity:"窗户",instance:"default"}}]}
    }
  ];
  const holdout=[
    {
      id:"holdout-bedroom",
      context:{room:"卧室",signal:"热",weather:"dry"},
      gold:{expected_targets:[{area:"卧室",entity:"空调",instance:"default"}],expected_action_count:1},
      baseline:{goal_completed:true,patches:[{target:{area:"卧室",entity:"空调",instance:"default"}}]}
    }
  ];
  const out=await evaluateReplayHoldout({train_cases:train,holdout_cases:holdout});
  assert.equal(out.train_pairs,1);
  assert.equal(out.conditioned_holdout,0);
  assert.equal(out.generalization_claim_supported,false);
  assert.deepEqual(out.baseline,out.replay);
  assert.equal(out.delta.wrong_target_reduction,0);
  assert.equal(out.delta.goal_completion_gain,0);

  console.log(JSON.stringify({
    ok:true,
    contract:"exact replay gains must not be reported as holdout generalization",
    holdout:out
  }));
})().catch(e=>{console.error(e);process.exit(1)});
