"use strict";
const assert=require("assert");
const {summarizeShadowReport}=require("../scripts/pi_home_shadow_eval.cjs");

const report={
  rows:[
    {
      id:"a",
      comparison:{any_disagreement:true},
      actual_outcome:{
        current:{provenance:"measured",goal_completed:false,wrong_target:1,correction_needed:1,extra_actions:1},
        shadow:{provenance:"counterfactual_simulation",trusted_for_promotion:true,goal_completed:true,wrong_target:0,correction_needed:0,extra_actions:0}
      }
    },
    {
      id:"b",
      comparison:{any_disagreement:true},
      actual_outcome:{
        current:{provenance:"measured",goal_completed:true,wrong_target:0,correction_needed:0,extra_actions:0},
        shadow:{provenance:"counterfactual_simulation",trusted_for_promotion:true,goal_completed:true,wrong_target:0,correction_needed:0,extra_actions:0}
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

const untrusted=summarizeShadowReport({
  rows:[{
    id:"c",
    comparison:{any_disagreement:true},
    actual_outcome:{
      current:{provenance:"measured",goal_completed:false},
      shadow:{goal_completed:true}
    }
  }]
});
assert.equal(untrusted.comparable,0);
assert.equal(untrusted.promotion_candidate,false);
assert.equal(untrusted.rows[0].reason,"unsupported_outcome_provenance");

const toy=summarizeShadowReport({
  rows:[{
    id:"toy",
    comparison:{any_disagreement:true},
    actual_outcome:{
      current:{provenance:"measured",goal_completed:false},
      shadow:{provenance:"counterfactual_simulation",trusted_for_promotion:false,goal_completed:true}
    }
  }]
});
assert.equal(toy.comparable,0);
assert.equal(toy.promotion_candidate,false);
assert.equal(toy.rows[0].reason,"simulator_not_trusted_for_promotion");

const partial=summarizeShadowReport({
  rows:[{
    id:"partial",
    comparison:{any_disagreement:true},
    actual_outcome:{
      current:{provenance:"measured",goal_completed:false},
      shadow:{
        provenance:"counterfactual_simulation",
        trusted_for_promotion:false,
        strategy:{
          complete_physics_coverage:false,
          physics_coverage_ratio:0.5
        },
        goal_completed:true
      }
    }
  }]
});
assert.equal(partial.comparable,0);
assert.equal(partial.promotion_candidate,false);
assert.equal(partial.rows[0].reason,"incomplete_physics_coverage");
assert.equal(partial.rows[0].shadow_provenance_assessment.physics_coverage_ratio,0.5);

console.log(JSON.stringify({
  ok:true,
  contract:"shadow disagreements require realized outcome advantage before promotion"
}));
