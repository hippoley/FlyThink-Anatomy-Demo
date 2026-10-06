"use strict";

const assert=require("assert");
const {ShadowPolicyMonitor}=require("../scripts/pi_home_shadow_policy.cjs");
const {attachShadowStrategyCounterfactual}=require("../scripts/pi_home_shadow_strategy_counterfactual.cjs");

(async()=>{
  const monitor=new ShadowPolicyMonitor({
    currentPredict:async()=>({
      decision:"EXECUTE",
      patches:[
        {op:"PATCH_SLOT",target:{area:"客厅",entity:"窗户",instance:"default"},slot:"opening",value:50}
      ]
    }),
    shadowPredict:async()=>({
      decision:"EXECUTE",
      patches:[
        {op:"PATCH_SLOT",target:{area:"客厅",entity:"窗户",instance:"default"},slot:"opening",value:75},
        {op:"PATCH_SLOT",target:{area:"卧室",entity:"窗户",instance:"default"},slot:"opening",value:25}
      ]
    })
  });

  await monitor.predict({turn_id:"strategy-turn",text:"有点闷"});
  monitor.attachOutcome("strategy-turn",{
    current:{
      provenance:"measured",
      goal_completed:false,
      wrong_target:0,
      correction_needed:0,
      extra_actions:0
    }
  });

  let seen=null;
  const adapter={
    simulate:async input=>{
      seen=input;
      return {
        provenance:"counterfactual_simulation",
        trusted_for_promotion:true,
        simulator:{service:"AirTrajectory",backend:"contamxpy",physics_fidelity:"CONTAM"},
        strategy:{
          patches:input.patches,
          simulated_actions:[
            {opening_id:"W1",target_pct:75},
            {opening_id:"W2",target_pct:25}
          ],
          unsupported_actions:[],
          complete_physics_coverage:true
        },
        result:{
          end_co2_ppm:860,
          end_co2_ppm_by_zone:{living:860,bedroom:900},
          path_flow_kg_s:{W1:.2,W2:.1},
          return_value:1.6
        }
      };
    }
  };

  const record=await attachShadowStrategyCounterfactual({
    monitor,
    record_id:"strategy-turn",
    adapter,
    origin:{
      co2_ppm:{living:1400,bedroom:950},
      opening_pct:{W1:25,W2:0}
    },
    goal:{co2_below:900},
    label:"cross-room"
  });

  assert.equal(seen.patches.length,2);
  assert.equal(record.actual_outcome.shadow.provenance,"counterfactual_simulation");
  assert.equal(record.actual_outcome.shadow.trusted_for_promotion,true);
  assert.equal(record.actual_outcome.shadow.goal_completed,true);
  assert.equal(record.actual_outcome.shadow.strategy.complete_physics_coverage,true);

  console.log(JSON.stringify({
    ok:true,
    contract:"multi-action shadow strategy can be attached from trusted simulator outcome"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
