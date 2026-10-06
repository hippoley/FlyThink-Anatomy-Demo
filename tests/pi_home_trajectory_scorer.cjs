"use strict";

const assert=require("assert");
const {scoreTrajectory}=require("../scripts/pi_home_trajectory_scorer.cjs");

function base(label){
  return {
    schema_version:"pi-home-trajectory-v1",
    outcome:{label},
    interventions:[],
    steps:[{score:0.4},{score:1}],
    summary:{steps:2,physical_actions:1}
  };
}

const success=scoreTrajectory(base("SUCCESS"));
assert.equal(success.quality,"HIGH");
assert.equal(success.positive_example,true);

const stalled=scoreTrajectory({
  ...base("STALLED"),
  steps:[{score:0.2},{score:0.2}],
  summary:{steps:2,physical_actions:3}
});
assert.equal(stalled.quality,"LOW");
assert.equal(stalled.negative_example,true);
assert.ok(success.score>stalled.score);

const corrected=scoreTrajectory({
  ...base("SUCCESS"),
  interventions:[{kind:"CORRECTION",text:"不是这个"}]
});
assert.ok(corrected.score<success.score);
assert.ok(corrected.score>stalled.score);

const oscillation=scoreTrajectory({
  ...base("OSCILLATION"),
  steps:[{score:0.3},{score:0.3},{score:0.3}],
  summary:{steps:3,physical_actions:3}
});
assert.equal(oscillation.components.stability,0);
assert.equal(oscillation.quality,"LOW");

console.log(JSON.stringify({
  ok:true,
  contract:"deterministic trajectory quality scoring for replay/training selection",
  scores:{success:success.score,corrected:corrected.score,stalled:stalled.score,oscillation:oscillation.score}
}));
