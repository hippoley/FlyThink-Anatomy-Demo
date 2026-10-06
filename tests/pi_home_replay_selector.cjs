"use strict";

const assert=require("assert");
const {selectReplaySamples}=require("../scripts/pi_home_replay_selector.cjs");

function trajectory(id,label,{score=1,interventions=[],actions=1,steps=2}={}){
  return {
    schema_version:"pi-home-trajectory-v1",
    episode_id:id,
    outcome:{label},
    interventions,
    steps:Array.from({length:steps},(_,i)=>({score:i===steps-1?score:Math.max(0,score-.2)})),
    summary:{steps,physical_actions:actions}
  };
}

const manifest=selectReplaySamples([
  trajectory("clean-success","SUCCESS",{score:1}),
  trajectory("corrected-success","SUCCESS",{
    score:1,
    interventions:[{kind:"CORRECTION",text:"不是这个"}]
  }),
  trajectory("preference-success","SUCCESS",{
    score:1,
    interventions:[{kind:"PREFERENCE_FEEDBACK",text:"有点吵"}]
  }),
  trajectory("stalled","STALLED",{score:.2,actions:4}),
  trajectory("oscillation","OSCILLATION",{score:.3,actions:5})
]);

assert.equal(manifest.schema_version,"pi-home-replay-manifest-v1");
assert.equal(manifest.counts.positive,1);
assert.equal(manifest.counts.hard,2);
assert.equal(manifest.counts.negative,2);
assert.equal(manifest.positive[0].episode_id,"clean-success");
assert.deepEqual(new Set(manifest.hard.map(x=>x.episode_id)),new Set(["corrected-success","preference-success"]));
assert.equal(manifest.negative[0].episode_id,"oscillation");
assert.ok(manifest.positive[0].score.score>manifest.negative[0].score.score);

console.log(JSON.stringify({
  ok:true,
  contract:"balanced replay buckets: clean success + recovered hard cases + low-quality negatives",
  counts:manifest.counts
}));
