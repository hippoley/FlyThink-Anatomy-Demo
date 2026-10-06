"use strict";
const assert=require("assert");
const {buildPreferencePairs}=require("../scripts/pi_home_preference_pairs.cjs");

const out=buildPreferencePairs([
  {
    id:"recover",
    gold:{},
    baseline:{goal_completed:false,patches:[{target:"bad"}]},
    replay:{goal_completed:true,patches:[{target:"good"}]},
    evidence:{intervention:"CORRECTION"}
  },
  {
    id:"missing-outcome",
    gold:{},
    baseline:{patches:[{target:"bad"}]},
    replay:{patches:[{target:"good"}]}
  },
  {
    id:"clean-success",
    gold:{},
    baseline:{goal_completed:true,patches:[{target:"same"}]},
    replay:{goal_completed:true,patches:[{target:"same"}]}
  }
]);

assert.equal(out.pairs.length,1);
assert.equal(out.pairs[0].id,"recover");
assert.equal(out.pairs[0].rationale,"measured_replay_recovered_goal");
assert.ok(out.skipped.some(x=>x.id==="missing-outcome"&&x.reason==="missing_measured_outcome"));
assert.ok(out.skipped.some(x=>x.id==="clean-success"&&x.reason==="no_behavioral_difference"));

console.log(JSON.stringify({ok:true,contract:"preference pairs require measured outcome evidence"}));
