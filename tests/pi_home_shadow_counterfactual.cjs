"use strict";

const assert=require("assert");
const {ShadowPolicyMonitor}=require("../scripts/pi_home_shadow_policy.cjs");
const {attachShadowCounterfactual}=require("../scripts/pi_home_shadow_counterfactual.cjs");

(async()=>{
  const monitor=new ShadowPolicyMonitor({
    currentPredict:async()=>({
      decision:"EXECUTE",
      patches:[{op:"PATCH_SLOT",target:{area:"客厅",entity:"窗户",instance:"default"},slot:"opening",value:50}]
    }),
    shadowPredict:async()=>({
      decision:"EXECUTE",
      patches:[{op:"PATCH_SLOT",target:{area:"客厅",entity:"窗户",instance:"default"},slot:"opening",value:75}]
    })
  });

  const selected=await monitor.predict({turn_id:"turn-1",text:"有点闷"});
  assert.equal(selected.patches[0].value,50);
  monitor.attachOutcome("turn-1",{
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
        result:{target_pct:75,end_co2_ppm:850,return_value:1.2}
      };
    }
  };

  const record=await attachShadowCounterfactual({
    monitor,
    record_id:"turn-1",
    adapter,
    origin:{co2_ppm:{living:1400},opening_pct:{W1:50}},
    goal:{co2_below:900}
  });

  assert.equal(seen.patch.value,75);
  assert.equal(record.actual_outcome.current.provenance,"measured");
  assert.equal(record.actual_outcome.shadow.provenance,"counterfactual_simulation");
  assert.equal(record.actual_outcome.shadow.trusted_for_promotion,true);
  assert.equal(record.actual_outcome.shadow.goal_completed,true);
  assert.equal(record.actual_outcome.shadow.end_co2_ppm,850);

  console.log(JSON.stringify({
    ok:true,
    contract:"shadow prediction is evaluated by simulator and attached with preserved provenance"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
