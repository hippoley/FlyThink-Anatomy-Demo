"use strict";
const assert=require("assert");
const {buildPreferencePairs}=require("../scripts/pi_home_preference_pairs.cjs");
const {createReplayConditionedPolicy}=require("../scripts/pi_home_replay_policy.cjs");
const {evaluateReplayPolicyHarness}=require("../scripts/pi_home_policy_replay_harness.cjs");

(async()=>{
  const cases=[
    {
      id:"known",
      context:{room:"厨房",signal:"闷",correction:"客厅窗"},
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
    },
    {
      id:"unknown",
      context:{room:"卧室",signal:"热"},
      gold:{
        expected_targets:[{area:"卧室",entity:"空调",instance:"default"}],
        expected_action_count:1,
        expected_goal_completion:true
      },
      baseline:{
        goal_completed:true,
        patches:[{target:{area:"卧室",entity:"空调",instance:"default"}}]
      },
      replay:{
        goal_completed:true,
        patches:[{target:{area:"卧室",entity:"空调",instance:"default"}}]
      }
    }
  ];

  const prefs=buildPreferencePairs(cases);
  const wrapper=createReplayConditionedPolicy({
    preferenceDataset:prefs,
    baselinePredict:async x=>x.baseline
  });

  const hit=await wrapper.predict({context:cases[0].context,baseline:cases[0].baseline});
  assert.equal(hit.replay_conditioned,true);
  assert.equal(hit.replay_evidence.pair_id,"known");
  assert.equal(hit.patches[0].target.area,"客厅");

  const miss=await wrapper.predict({context:{room:"书房"},baseline:cases[1].baseline});
  assert.equal(miss.replay_conditioned,false);
  assert.equal(miss.patches[0].target.area,"卧室");

  const out=await evaluateReplayPolicyHarness(cases);
  assert.equal(out.memory_size,1);
  assert.equal(out.conditioned_cases,1);
  assert.equal(out.delta.wrong_target_reduction,1);
  assert.equal(out.delta.correction_reduction,1);
  assert.equal(out.delta.goal_completion_gain,1);

  console.log(JSON.stringify({
    ok:true,
    contract:"replay evidence may override baseline only on an exact measured-context hit",
    delta:out.delta
  }));
})().catch(e=>{console.error(e);process.exit(1)});
