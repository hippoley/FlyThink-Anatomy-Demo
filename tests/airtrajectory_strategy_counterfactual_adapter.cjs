"use strict";

const assert=require("assert");
const {
  AirTrajectoryStrategyCounterfactualAdapter,
  buildStrategyRequest
}=require("../scripts/airtrajectory_strategy_counterfactual_adapter.cjs");

const patches=[
  {op:"PATCH_SLOT",target:{area:"客厅",entity:"窗户",instance:"default"},slot:"opening",value:75},
  {op:"PATCH_SLOT",target:{area:"卧室",entity:"窗户",instance:"default"},slot:"opening",value:25}
];
const origin={
  co2_ppm:{living:1400,bedroom:950},
  opening_pct:{W1:25,W2:0},
  scalar_values:{FAN1:1}
};

(async()=>{
  let seen=null;
  const adapter=new AirTrajectoryStrategyCounterfactualAdapter({
    profile_id:"home-v1",
    opening_map:{
      "客厅::窗户::default":"W1",
      "卧室::窗户::default":"W2"
    },
    actuator_map:{
      "厨房::风机::default":"FAN1"
    },
    transport:async req=>{
      seen=req;
      return {
        schema_version:"0.4",
        profile_id:"home-v1",
        topology_id:"home-v1",
        backend:"contamxpy",
        physics_fidelity:"CONTAM",
        trusted_for_promotion:true,
        horizon_minutes:10,
        branches:[{
          label:req.candidates[0].label,
          actions:req.candidates[0].actions,
          end_co2_ppm:870,
          end_co2_ppm_by_zone:{living:870,bedroom:900},
          path_flow_kg_s:{W1:.2,W2:.1},
          end_scalar_values:{FAN1:2},
          series:[1400,1100,870],
          return:1.5,
          provenance:"backend-generated · CONTAM · engineering simulation",
          trusted_for_promotion:true
        }]
      };
    }
  });
  const out=await adapter.simulate({label:"cross-room",patches,origin,horizon_minutes:10});
  assert.equal(seen.candidates[0].actions.length,2);
  assert.equal(out.strategy.simulated_actions.length,2);
  assert.equal(out.strategy.unsupported_actions.length,0);
  assert.equal(out.strategy.complete_physics_coverage,true);
  assert.equal(out.strategy.physics_coverage_ratio,1);
  assert.equal(out.strategy.simulated_action_count,2);
  assert.equal(out.strategy.unsupported_action_count,0);
  assert.equal(out.trusted_for_promotion,true);
  assert.equal(out.result.end_co2_ppm,870);
  assert.deepEqual(out.result.end_scalar_values,{FAN1:2});

  const scalar=await adapter.simulate({
    label:"fan",
    patches:[
      {op:"PATCH_SLOT",target:{area:"厨房",entity:"风机",instance:"default"},slot:"level",value:2}
    ],
    origin
  });
  assert.deepEqual(seen.candidates[0].actions,[{actuator_id:"FAN1",target_value:2}]);
  assert.equal(scalar.strategy.unsupported_actions.length,0);
  assert.equal(scalar.strategy.complete_physics_coverage,true);
  assert.equal(scalar.trusted_for_promotion,true);

  const mixed=await adapter.simulate({
    label:"mixed",
    patches:[
      patches[0],
      {op:"PATCH_SLOT",target:{area:"厨房",entity:"油烟机",instance:"default"},slot:"level",value:2}
    ],
    origin
  });
  assert.equal(mixed.strategy.simulated_actions.length,1);
  assert.equal(mixed.strategy.unsupported_actions.length,1);
  assert.equal(mixed.strategy.complete_physics_coverage,false);
  assert.equal(mixed.strategy.physics_coverage_ratio,0.5);
  assert.equal(mixed.strategy.simulated_action_count,1);
  assert.equal(mixed.strategy.unsupported_action_count,1);
  assert.equal(mixed.trusted_for_promotion,false);
  assert.equal(mixed.simulator.trust_reason,"strategy_partially_simulated");

  const stale=new AirTrajectoryStrategyCounterfactualAdapter({
    profile_id:"home-v1",
    opening_map:{"客厅::窗户::default":"W1"},
    transport:async()=>({
      schema_version:"0.3",
      profile_id:"home-v1",
      backend:"contamxpy",
      physics_fidelity:"CONTAM",
      branches:[]
    })
  });
  await assert.rejects(
    stale.simulate({label:"stale",patches:[patches[0]],origin}),
    /schema_too_old/
  );

  const mismatch=new AirTrajectoryStrategyCounterfactualAdapter({
    profile_id:"home-v1",
    opening_map:{"客厅::窗户::default":"W1"},
    transport:async()=>({
      schema_version:"0.4",
      profile_id:"other-home",
      backend:"contamxpy",
      physics_fidelity:"CONTAM",
      branches:[]
    })
  });
  await assert.rejects(
    mismatch.simulate({label:"mismatch",patches:[patches[0]],origin}),
    /profile_mismatch/
  );

  const built=buildStrategyRequest({
    profile_id:"home-v1",
    patches,
    origin,
    opening_map:{
      "客厅::窗户::default":"W1",
      "卧室::窗户::default":"W2"
    },
    actuator_map:{
      "厨房::风机::default":"FAN1"
    }
  });
  assert.equal(built.unsupported_actions.length,0);

  console.log(JSON.stringify({
    ok:true,
    contract:"opening and mapped scalar strategies are promotable only with complete simulator coverage"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
