"use strict";

const assert=require("assert");
const {rankStrategyCandidates}=require("../scripts/pi_home_strategy_ranker.cjs");

function outcome({co2,ret,coverage=true,trusted=true}){
  return {
    provenance:"counterfactual_simulation",
    trusted_for_promotion:trusted,
    strategy:{
      complete_physics_coverage:coverage,
      physics_coverage_ratio:coverage?1:0.5
    },
    result:{
      end_co2_ppm:co2,
      return_value:ret
    }
  };
}

const out=rankStrategyCandidates([
  {label:"balanced",outcome:outcome({co2:880,ret:1.3})},
  {label:"aggressive",outcome:outcome({co2:820,ret:0.8})},
  {label:"partial",outcome:outcome({co2:790,ret:2.0,coverage:false})},
  {label:"untrusted",outcome:outcome({co2:760,ret:2.1,trusted:false})}
],{
  constraints:[
    {id:"co2-safe-progress",path:"result.end_co2_ppm",op:"<",value:950}
  ],
  objectives:[
    {id:"iaq",path:"result.end_co2_ppm",direction:"min",weight:0.7},
    {id:"return",path:"result.return_value",direction:"max",weight:0.3}
  ]
});

assert.equal(out.ranked.length,2);
assert.equal(out.blocked.length,2);
assert.equal(out.blocked.find(x=>x.label==="partial").blocked_reason,"incomplete_physics_coverage");
assert.equal(out.blocked.find(x=>x.label==="untrusted").blocked_reason,"simulator_not_trusted_for_promotion");
assert.equal(out.winner.label,"aggressive");
assert.ok(out.ranked[0].score>out.ranked[1].score);

const missing=rankStrategyCandidates([
  {
    label:"missing",
    outcome:{
      provenance:"counterfactual_simulation",
      trusted_for_promotion:true,
      strategy:{complete_physics_coverage:true},
      result:{end_co2_ppm:850}
    }
  }
],{
  objectives:[{id:"return",path:"result.return_value",direction:"max",required:true}]
});
assert.equal(missing.ranked.length,0);
assert.equal(missing.blocked[0].blocked_reason,"required_objective_missing");

console.log(JSON.stringify({
  ok:true,
  contract:"strategy ranking uses only trusted complete simulator evidence and required metrics",
  winner:out.winner.label
}));
