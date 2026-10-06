"use strict";

const assert=require("assert");
const {AirTrajectoryStrategyCounterfactualAdapter}=require("../scripts/airtrajectory_strategy_counterfactual_adapter.cjs");
const {runStrategyTournament}=require("../scripts/pi_home_strategy_tournament.cjs");

const target=(area)=>({area,entity:"窗户",instance:"default"});
const candidates=[
  {
    label:"balanced",
    patches:[
      {op:"PATCH_SLOT",target:target("客厅"),slot:"opening",value:75},
      {op:"PATCH_SLOT",target:target("卧室"),slot:"opening",value:25}
    ]
  },
  {
    label:"quiet",
    patches:[
      {op:"PATCH_SLOT",target:target("客厅"),slot:"opening",value:50},
      {op:"PATCH_SLOT",target:target("卧室"),slot:"opening",value:50}
    ]
  },
  {
    label:"mixed-unsupported",
    patches:[
      {op:"PATCH_SLOT",target:target("客厅"),slot:"opening",value:75},
      {op:"PATCH_SLOT",target:{area:"厨房",entity:"油烟机",instance:"default"},slot:"level",value:2}
    ]
  }
];

(async()=>{
  let calls=0;
  let seen=null;
  const adapter=new AirTrajectoryStrategyCounterfactualAdapter({
    profile_id:"home-v1",
    opening_map:{
      "客厅::窗户::default":"W1",
      "卧室::窗户::default":"W2"
    },
    transport:async req=>{
      calls++;
      seen=req;
      return {
        profile_id:"home-v1",
        topology_id:"home-v1",
        backend:"contamxpy",
        physics_fidelity:"CONTAM",
        trusted_for_promotion:true,
        horizon_minutes:10,
        branches:req.candidates.map(c=>{
          const config={
            balanced:{co2:850,ret:1.3},
            quiet:{co2:900,ret:1.5},
            "mixed-unsupported":{co2:820,ret:1.8}
          }[c.label];
          return {
            label:c.label,
            actions:c.actions,
            end_co2_ppm:config.co2,
            end_co2_ppm_by_zone:{living:config.co2,bedroom:900},
            path_flow_kg_s:{W1:.2,W2:.1},
            series:[1400,config.co2],
            return:config.ret,
            provenance:"backend-generated · CONTAM · engineering simulation",
            trusted_for_promotion:true
          };
        })
      };
    }
  });

  const out=await runStrategyTournament({
    adapter,
    candidates,
    origin:{
      co2_ppm:{living:1400,bedroom:950},
      opening_pct:{W1:25,W2:0}
    },
    horizon_minutes:10,
    request_id:"tournament-1",
    constraints:[
      {id:"iaq-floor",path:"result.end_co2_ppm",op:"<",value:950}
    ],
    objectives:[
      {id:"iaq",path:"result.end_co2_ppm",direction:"min",weight:.7},
      {id:"return",path:"result.return_value",direction:"max",weight:.3}
    ]
  });

  assert.equal(calls,1);
  assert.equal(seen.candidates.length,3);
  assert.equal(out.simulated,3);
  assert.equal(out.ranking.ranked.length,2);
  assert.equal(out.ranking.blocked.length,1);
  assert.equal(out.ranking.blocked[0].label,"mixed-unsupported");
  assert.equal(out.ranking.blocked[0].blocked_reason,"simulator_not_trusted_for_promotion");
  assert.equal(out.winner.label,"balanced");

  console.log(JSON.stringify({
    ok:true,
    contract:"candidate strategies share one counterfactual origin and only fully-covered branches can win",
    winner:out.winner.label
  }));
})().catch(e=>{console.error(e);process.exit(1)});
