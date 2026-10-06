"use strict";

const assert=require("assert");
const fs=require("fs");
const {
  evaluateLearnedCandidatePhysics,
  createCasePhysicsAdapter
}=require("../scripts/pi_home_learned_candidate_physics.cjs");

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
            simulated_actions:[
              patch.slot==="opening"
                ?{kind:"opening",opening_id:"W"+String(index+1),target_pct:patch.value}
                :{kind:"scalar",actuator_id:"FAN1",target_value:patch.value}
            ],
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
  let quietRequest=null;
  const realQuietAdapter=createCasePhysicsAdapter(quiet,{
    transport:async req=>{
      quietRequest=req;
      return {
        schema_version:"0.4",
        profile_id:quiet.physics.profile_id,
        topology_id:quiet.physics.topology_id,
        backend:"contamxpy",
        physics_fidelity:"CONTAM",
        trusted_for_promotion:true,
        horizon_minutes:30,
        branches:req.candidates.map((candidate,index)=>({
          label:candidate.label,
          actions:candidate.actions,
          end_co2_ppm:index===1?820:930,
          end_co2_ppm_by_zone:{living:index===1?820:930,bedroom:900},
          path_flow_kg_s:{W1:.2},
          end_scalar_values:{FAN1:2},
          series:[1400,index===1?820:930],
          return:index===1?2:1,
          provenance:"backend-generated · CONTAM · engineering simulation",
          trusted_for_promotion:true
        }))
      };
    }
  });
  const quietOut=await evaluateLearnedCandidatePhysics({
    case_def:quiet,
    learned_row:rowFor(quiet),
    adapter:realQuietAdapter,
    constraints:[{path:"result.end_co2_ppm",op:"<",value:1000}],
    objectives:[{path:"result.end_co2_ppm",direction:"min",weight:1}],
    request_id:"quiet"
  });
  assert.equal(quietRequest.candidates.length,2);
  assert.deepEqual(quietRequest.candidates[0].actions,[
    {actuator_id:"FAN1",target_value:2}
  ]);
  assert.deepEqual(quietRequest.candidates[1].actions,[
    {opening_id:"W1",target_pct:55}
  ]);
  assert.deepEqual(quietRequest.origin.scalar_values,{FAN1:1});
  assert.equal(quietOut.candidate_set.total,2);
  assert.equal(quietOut.candidate_set.eligible.length,2);
  assert.equal(quietOut.candidate_set.unsupported.length,0);
  assert.equal(quietOut.candidate_set.candidate_set_complete,true);
  assert.equal(quietOut.decision,"COUNTERFACTUAL_CONFIRMED");
  assert.equal(quietOut.counterfactual_confirmed,true);
  assert.equal(quietOut.trusted_for_generalization_claim,true);

  const quietWithoutMapping=JSON.parse(JSON.stringify(quiet));
  quietWithoutMapping.physics.actuator_map={};
  const blockedQuiet=await evaluateLearnedCandidatePhysics({
    case_def:quietWithoutMapping,
    learned_row:rowFor(quietWithoutMapping),
    adapter:adapterFor(quietWithoutMapping,quietWithoutMapping.gold.expected_targets[0]),
    constraints:[{path:"result.end_co2_ppm",op:"<",value:1000}],
    objectives:[{path:"result.end_co2_ppm",direction:"min",weight:1}],
    request_id:"quiet-mapping-missing"
  });
  assert.equal(blockedQuiet.candidate_set.eligible.length,1);
  assert.equal(blockedQuiet.candidate_set.unsupported.length,1);
  assert.equal(blockedQuiet.decision,"BLOCKED");
  assert.equal(blockedQuiet.reason,"candidate_set_incomplete_physics_coverage");

  const rain=data.cases.find(x=>x.id==="topology-rain-new-apt");
  const rainOut=await evaluateLearnedCandidatePhysics({
    case_def:rain,
    learned_row:rowFor(rain),
    adapter:adapterFor(rain,rain.gold.expected_targets[0]),
    constraints:[{path:"result.end_co2_ppm",op:"<",value:1000}],
    objectives:[{path:"result.end_co2_ppm",direction:"min",weight:1}],
    request_id:"rain"
  });
  assert.equal(rainOut.candidate_set.total,3);
  assert.equal(rainOut.candidate_set.eligible.length,3);
  assert.equal(rainOut.candidate_set.unsupported.length,0);
  assert.equal(rainOut.candidate_set.candidate_set_complete,true);
  assert.equal(rainOut.decision,"COUNTERFACTUAL_CONFIRMED");
  assert.equal(rainOut.counterfactual_confirmed,true);
  assert.equal(rainOut.trusted_for_generalization_claim,true);

  console.log(JSON.stringify({
    ok:true,
    contract:"mapped mechanical actuators close candidate-set physics coverage; missing mappings still fail closed"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
