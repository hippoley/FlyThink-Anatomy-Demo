"use strict";
const assert=require("assert");
const {buildAdvantageDataset}=require("../scripts/pi_home_advantage.cjs");

const data=buildAdvantageDataset([
  {
    id:"wrong-target-recovery",
    gold:{
      expected_targets:[{area:"客厅",entity:"窗户",instance:"default"}],
      expected_action_count:1,
      expected_goal_completion:true
    },
    baseline:{
      goal_completed:false,
      requires_correction:true,
      patches:[{target:{area:"厨房",entity:"窗户",instance:"default"}}]
    },
    replay:{
      goal_completed:true,
      patches:[{target:{area:"客厅",entity:"窗户",instance:"default"}}]
    }
  }
]);

assert.equal(data.rows.length,1);
assert.equal(data.rows[0].preferred,"replay");
assert.ok(data.rows[0].advantage>0);
assert.equal(data.positive_advantage,1);

console.log(JSON.stringify({
  ok:true,
  contract:"advantage signal rewards measured completion and penalizes wrong-target/correction/extra actions",
  row:data.rows[0]
}));
