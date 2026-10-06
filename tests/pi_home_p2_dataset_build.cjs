"use strict";
const assert=require("assert");
const {buildPreferencePairs}=require("../scripts/pi_home_preference_pairs.cjs");
const {buildAdvantageDataset}=require("../scripts/pi_home_advantage.cjs");

const cases=[
  {
    id:"measured-recovery",
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
];

const prefs=buildPreferencePairs(cases);
const adv=buildAdvantageDataset(cases);
assert.equal(prefs.pairs.length,1);
assert.equal(prefs.pairs[0].chosen.goal_completed,true);
assert.equal(prefs.pairs[0].rejected.goal_completed,false);
assert.equal(adv.positive_advantage,1);
assert.ok(adv.rows[0].advantage>0);

console.log(JSON.stringify({
  ok:true,
  contract:"single-source P2 dataset build keeps preference and advantage labels consistent"
}));
