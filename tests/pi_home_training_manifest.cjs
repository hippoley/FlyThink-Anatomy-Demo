"use strict";

const assert=require("assert");
const {buildTrainingManifest}=require("../scripts/pi_home_training_manifest.cjs");

function row(id,bucket,score,label){
  return {
    episode_id:id,
    bucket,
    score:{score,quality:score>=.8?"HIGH":(score>=.5?"MEDIUM":"LOW"),outcome_label:label},
    trajectory:{goal:{type:"comfort"},steps:[{score}],interventions:[]}
  };
}
const replay={
  schema_version:"pi-home-replay-manifest-v1",
  positive:[row("p","positive",.95,"SUCCESS")],
  hard:[row("h","hard",.75,"SUCCESS")],
  negative:[row("n","negative",.2,"OSCILLATION")]
};
const out=buildTrainingManifest(replay);

assert.equal(out.schema_version,"pi-home-training-manifest-v1");
assert.deepEqual(out.counts,{total:3,imitate:1,recover:1,avoid:1});
const p=out.samples.find(x=>x.episode_id==="p");
const h=out.samples.find(x=>x.episode_id==="h");
const n=out.samples.find(x=>x.episode_id==="n");
assert.equal(p.mode,"IMITATE");
assert.equal(h.mode,"RECOVER");
assert.equal(n.mode,"AVOID");
assert.ok(h.weight>p.weight);
assert.ok(p.weight>n.weight);
assert.ok(out.total_weight>0);

console.log(JSON.stringify({
  ok:true,
  contract:"weighted training manifest separates imitation, recovery and avoidance",
  weights:{positive:p.weight,hard:h.weight,negative:n.weight}
}));
