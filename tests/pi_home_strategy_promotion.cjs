"use strict";

const assert=require("assert");
const {buildStrategyPromotionEvidence}=require("../scripts/pi_home_strategy_promotion.cjs");

function winnerOutcome(co2){
  return {
    provenance:"counterfactual_simulation",
    trusted_for_promotion:true,
    simulator:{service:"AirTrajectory",backend:"contamxpy",physics_fidelity:"CONTAM"},
    strategy:{
      patches:[],
      simulated_actions:[
        {opening_id:"W1",target_pct:75},
        {opening_id:"W2",target_pct:25}
      ],
      unsupported_actions:[],
      simulated_action_count:2,
      unsupported_action_count:0,
      physics_coverage_ratio:1,
      complete_physics_coverage:true
    },
    result:{
      end_co2_ppm:co2,
      end_co2_ppm_by_zone:{living:co2,bedroom:900},
      path_flow_kg_s:{W1:.2,W2:.1},
      return_value:1.4
    }
  };
}

const tournament={
  schema_version:"pi-home-strategy-tournament-v1",
  request_id:"tour-1",
  winner:{label:"cross-room",score:.9,outcome:winnerOutcome(850)},
  ranking:{
    ranked:[{label:"cross-room",score:.9,objectives:[{id:"iaq",actual:850}]}],
    blocked:[{label:"mixed",blocked_reason:"simulator_not_trusted_for_promotion"}]
  }
};

const promoted=buildStrategyPromotionEvidence({
  tournament,
  current_outcome:{
    provenance:"measured",
    goal_completed:false,
    wrong_target:0,
    correction_needed:0,
    extra_actions:0
  },
  goal:{co2_below:900},
  min_advantage:.1
});
assert.equal(promoted.decision,"SHADOW_PROMOTION_CANDIDATE");
assert.equal(promoted.execution_authorized,false);
assert.equal(promoted.winner_label,"cross-room");
assert.ok(promoted.estimated_advantage>.1);
assert.equal(promoted.ranking_summary.blocked[0].label,"mixed");

const alreadyGood=buildStrategyPromotionEvidence({
  tournament,
  current_outcome:{
    provenance:"measured",
    goal_completed:true,
    wrong_target:0,
    correction_needed:0,
    extra_actions:0
  },
  goal:{co2_below:900},
  min_advantage:.1
});
assert.equal(alreadyGood.decision,"KEEP_CURRENT");
assert.equal(alreadyGood.reason,"advantage_below_threshold");

const blocked=buildStrategyPromotionEvidence({
  tournament,
  current_outcome:{
    provenance:"predicted",
    goal_completed:false
  },
  goal:{co2_below:900}
});
assert.equal(blocked.decision,"BLOCKED");
assert.equal(blocked.reason,"current_outcome_not_trusted");

console.log(JSON.stringify({
  ok:true,
  contract:"counterfactual winner becomes a promotion candidate only with trusted current evidence and positive advantage"
}));
