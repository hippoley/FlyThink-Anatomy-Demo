"use strict";
const assert=require("assert");
const {summarizeShadowReport}=require("../scripts/pi_home_shadow_eval.cjs");

const report={
  rows:[
    {
      id:"a",
      comparison:{any_disagreement:true},
      actual_outcome:{
        current:{goal_completed:false,wrong_target:1,correction_needed:1,extra_actions:1},
        shadow:{goal_completed:true,wrong_target:0,correction_needed:0,extra_actions:0}
      }
    },
    {
      id:"b",
      comparison:{any_disagreement:true},
      actual_outcome:{
        current:{goal_completed:true,wrong_target:0,correction_needed:0,extra_actions:0},
        shadow:{goal_completed:true,wrong_target:0,correction_needed:0,extra_actions:0}
      }
    }
  ]
};

const out=summarizeShadowReport(report);
assert.equal(out.comparable,2);
assert.equal(out.disagreement_cases,2);
assert.equal(out.shadow_wins,1);
assert.equal(out.current_wins,0);
assert.equal(out.ties,1);
assert.ok(out.average_realized_advantage>0);
assert.equal(out.promotion_candidate,true);

console.log(JSON.stringify({
  ok:true,
  contract:"shadow disagreements require realized outcome advantage before promotion"
}));
