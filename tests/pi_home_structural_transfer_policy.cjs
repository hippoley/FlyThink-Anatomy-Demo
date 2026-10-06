"use strict";
const assert=require("assert");
const {
  learnStructuralTransferRules,
  createStructuralTransferPolicy
}=require("../scripts/pi_home_structural_transfer_policy.cjs");

(async()=>{
  const train=[
    {
      id:"train-wrong-room-kitchen",
      context:{
        intent_family:"wrong-room-correction",
        room:"厨房",
        references:{corrected_target:{area:"客厅",entity:"窗户",instance:"default"}}
      },
      baseline:{
        goal_completed:false,
        requires_correction:true,
        patches:[{target:{area:"厨房",entity:"窗户",instance:"default"}}]
      },
      replay:{
        goal_completed:true,
        patches:[{target:{area:"客厅",entity:"窗户",instance:"default"}}]
      }
    },
    {
      id:"train-topology-a",
      context:{
        intent_family:"topology-opening-selection",
        topology:{preferred_opening:{area:"客厅",entity:"窗户",instance:"east"}}
      },
      baseline:{
        goal_completed:false,
        patches:[{target:{area:"客厅",entity:"窗户",instance:"west"}}]
      },
      replay:{
        goal_completed:true,
        patches:[{target:{area:"客厅",entity:"窗户",instance:"east"}}]
      }
    }
  ];

  const learned=learnStructuralTransferRules(train);
  assert.equal(learned.rules["wrong-room-correction"].target_source_path,"references.corrected_target");
  assert.equal(learned.rules["topology-opening-selection"].target_source_path,"topology.preferred_opening");

  const policy=createStructuralTransferPolicy({
    train_cases:train,
    baselinePredict:async input=>input.baseline
  });

  const unseen=await policy.predict({
    context:{
      intent_family:"wrong-room-correction",
      room:"卧室",
      references:{corrected_target:{area:"书房",entity:"窗户",instance:"default"}}
    },
    baseline:{
      goal_completed:false,
      requires_correction:true,
      patches:[{target:{area:"卧室",entity:"窗户",instance:"default"}}]
    }
  });
  assert.equal(unseen.structural_transfer,true);
  assert.equal(unseen.replay_conditioned,false);
  assert.equal(unseen.patches[0].target.area,"书房");
  assert.equal(unseen.transfer_evidence.target_source_path,"references.corrected_target");

  const topology=await policy.predict({
    context:{
      intent_family:"topology-opening-selection",
      topology:{preferred_opening:{area:"书房",entity:"窗户",instance:"north"}}
    },
    baseline:{
      goal_completed:false,
      patches:[{target:{area:"书房",entity:"窗户",instance:"south"}}]
    }
  });
  assert.equal(topology.patches[0].target.instance,"north");

  const miss=await policy.predict({
    context:{intent_family:"unknown-family"},
    baseline:{goal_completed:true,patches:[]}
  });
  assert.equal(miss.structural_transfer,false);
  assert.equal(miss.transfer_reason,"rule_missing");

  console.log(JSON.stringify({
    ok:true,
    contract:"structural transfer learns context relation paths from recovery data without exact context replay"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
