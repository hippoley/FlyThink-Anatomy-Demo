"use strict";

const assert=require("assert");
const fs=require("fs");
const {evaluateLearnedCandidatePhysics}=require("../scripts/pi_home_learned_candidate_physics.cjs");

const data=JSON.parse(fs.readFileSync("benchmarks/pi_home_candidate_generalization.json","utf8"));

function rowFor(caseDef){
  const gold=caseDef.gold.expected_targets[0];
  return {
    id:caseDef.id,
    predicted:gold,
    ranking:[
      {target:gold,score:1},
      ...caseDef.context.candidates
        .filter(x=>JSON.stringify(x.target)!==JSON.stringify(gold))
        .map((x,i)=>({target:x.target,score:.5-i*.1}))
    ]
  };
}

function adapterFor(caseDef,bestTarget){
  return {
    simulateMany:async({candidates})=>candidates.map((candidate,index)=>{
      const patch=candidate.patches[0];
      const isBest=JSON.stringify(patch.target)===JSON.stringify(bestTarget);
      return {
        label:candidate.label,
        outcome:{
          provenance:"counterfactual_simulation",
          trusted_for_promotion:true,
          simulator:{service:"AirTrajectory",backend:"contamxpy",physics_fidelity:"CONTAM"},
          strategy:{
            patches:[patch],
            simulated_actions:[{opening_id:"W"+String(index+1),target_pct:patch.value}],
            unsupported_actions:[],
            simulated_action_count:1,
            unsupported_action_count:0,
            physics_coverage_ratio:1,
            complete_physics_coverage:true
          },
          result:{
            end_co2_ppm:isBest?820:950+index*20,
            return_value:isBest?2:1
          }
        }
      };
    })
  };
}

(async()=>{
  const quiet=data.cases.find(x=>x.id==="compose-quiet-new-room");
  const quietOut=await evaluateLearnedCandidatePhysics({
    case_def:quiet,
    learned_row:rowFor(quiet),
    adapter:adapterFor(quiet,quiet.gold.expected_targets[0]),
    constraints:[{path:"result.end_co2_ppm",op:"<",value:1000}],
    objectives:[{path:"result.end_co2_ppm",direction:"min",weight:1}],
    evidence_dimensions:["co2","airflow"],
    request_id:"quiet"
  });
  assert.equal(quietOut.candidate_set.total,2);
  assert.equal(quietOut.candidate_set.eligible.length,1);
  assert.equal(quietOut.candidate_set.unsupported.length,1);
  assert.equal(quietOut.candidate_set.candidate_set_complete,false);
  assert.equal(quietOut.decision,"BLOCKED");
  assert.equal(quietOut.reason,"candidate_set_incomplete_physics_coverage");
  assert.equal(quietOut.trusted_for_generalization_claim,false);

  const rain=data.cases.find(x=>x.id==="topology-rain-new-apt");
  const rainOut=await evaluateLearnedCandidatePhysics({
    case_def:rain,
    learned_row:rowFor(rain),
    adapter:adapterFor(rain,rain.gold.expected_targets[0]),
    constraints:[{path:"result.end_co2_ppm",op:"<",value:1000}],
    objectives:[{path:"result.end_co2_ppm",direction:"min",weight:1}],
    evidence_dimensions:["co2","airflow"],
    request_id:"rain"
  });
  assert.equal(rainOut.candidate_set.total,3);
  assert.equal(rainOut.candidate_set.eligible.length,3);
  assert.equal(rainOut.candidate_set.unsupported.length,0);
  assert.equal(rainOut.candidate_set.candidate_set_complete,true);
  assert.equal(rainOut.decision,"PARTIAL_PHYSICS_EVIDENCE");
  assert.equal(rainOut.reason,"physics_constraint_coverage_incomplete");
  assert.deepEqual(rainOut.physics_dimensions.missing,["rain_ingress"]);
  assert.equal(rainOut.counterfactual_confirmed,false);
  assert.equal(rainOut.trusted_for_generalization_claim,false);

  const rainFullyCovered=await evaluateLearnedCandidatePhysics({
    case_def:rain,
    learned_row:rowFor(rain),
    adapter:adapterFor(rain,rain.gold.expected_targets[0]),
    constraints:[{path:"result.end_co2_ppm",op:"<",value:1000}],
    objectives:[{path:"result.end_co2_ppm",direction:"min",weight:1}],
    evidence_dimensions:["co2","airflow","rain_ingress"],
    request_id:"rain-full"
  });
  assert.equal(rainFullyCovered.decision,"COUNTERFACTUAL_CONFIRMED");
  assert.equal(rainFullyCovered.physics_dimensions.complete,true);
  assert.equal(rainFullyCovered.counterfactual_confirmed,true);
  assert.equal(rainFullyCovered.trusted_for_generalization_claim,true);

  console.log(JSON.stringify({
    ok:true,
    contract:"learned target may claim physical confirmation only when the entire candidate set is physically comparable"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
