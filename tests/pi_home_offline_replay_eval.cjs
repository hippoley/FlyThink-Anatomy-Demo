"use strict";
const assert=require("assert");
const {evaluateOfflineReplay}=require("../scripts/pi_home_offline_replay_eval.cjs");

const out=evaluateOfflineReplay([
  {
    id:"case-1",
    gold:{
      expected_targets:[{area:"客厅",entity:"窗户",instance:"default"}],
      expected_action_count:1,
      expected_goal_completion:true
    },
    baseline:{
      patches:[{target:{area:"厨房",entity:"窗户",instance:"default"}}],
      requires_correction:true
    },
    replay:{
      patches:[{target:{area:"客厅",entity:"窗户",instance:"default"}}]
    }
  },
  {
    id:"case-2",
    gold:{
      expected_targets:[{area:"客厅",entity:"窗户",instance:"default"}],
      expected_action_count:1,
      expected_goal_completion:true
    },
    baseline:{
      patches:[
        {target:{area:"客厅",entity:"窗户",instance:"default"}},
        {target:{area:"客厅",entity:"窗户",instance:"default"}},
        {target:{area:"客厅",entity:"窗户",instance:"default"}}
      ]
    },
    replay:{
      patches:[{target:{area:"客厅",entity:"窗户",instance:"default"}}]
    }
  }
]);

assert.equal(out.schema_version,"pi-home-offline-replay-eval-v1");
assert.equal(out.delta.wrong_target_reduction,1);
assert.equal(out.delta.correction_reduction,1);
assert.equal(out.delta.extra_action_reduction,2);
assert.equal(out.delta.goal_completion_gain,1);
assert.ok(out.replay.goal_completion_rate>out.baseline.goal_completion_rate);

console.log(JSON.stringify({
  ok:true,
  contract:"offline replay must show measurable Reality Delta before training",
  delta:out.delta
}));
