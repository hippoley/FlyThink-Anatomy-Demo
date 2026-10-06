"use strict";

const assert=require("assert");
const {MockThingDriver}=require("../scripts/physical_runtime.cjs");
const {HomeGoalRuntime}=require("../scripts/home_goal_runtime.cjs");

function target(area,entity){return {area,entity,instance:"default"}}
function key(area,entity){return area+"::"+entity+"::default"}
function patch(area,entity,slot,value){return {op:"PATCH_SLOT",target:target(area,entity),slot,value}}

function runtime(){
  return {
    devices:{
      [key("客厅","窗户")]:{
        key:key("客厅","窗户"),area:"客厅",entity:"窗户",instance:"default",
        status:"mounted",model_id:"CWDS-CA01",slots:{opening:20}
      },
      [key("厨房","油烟机")]:{
        key:key("厨房","油烟机"),area:"厨房",entity:"油烟机",instance:"default",
        status:"mounted",model_id:"RANGE-HOOD-01",slots:{level:2}
      }
    }
  };
}

function desired(){
  return [{id:"co2",source:"observation",path:"kitchen.co2",op:"<",value:900}];
}

async function correctionAndPreferenceBecomeStructuredData(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({id:"feedback",goal:{type:"comfort"},strategy:{name:"normal"},desired_state:desired()});

  const correction=await goals.handleHumanIntervention("feedback",{
    kind:"CORRECTION",
    text:"不是这个，是客厅窗",
    correction:{from:"厨房窗",to:"客厅窗"},
    target:target("客厅","窗户")
  });
  assert.equal(correction.event.kind,"CORRECTION");

  const preference=await goals.handleHumanIntervention("feedback",{
    kind:"PREFERENCE_FEEDBACK",
    text:"有点吵",
    dimension:"noise",
    sentiment:"negative"
  });
  assert.equal(preference.event.kind,"PREFERENCE_FEEDBACK");

  const ep=goals.getEpisode("feedback");
  assert.equal(ep.interventions.length,2);
  assert.equal(ep.feedback.length,2);
}

async function cancelCreatesTrainingOutcomeAndRollback(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({id:"cancel",goal:{type:"comfort"},strategy:{name:"normal"},desired_state:desired()});
  await goals.applyAgentPatches("cancel",[patch("客厅","窗户","opening",70)],{turn_id:"goal:cancel:1"});

  const out=await goals.handleHumanIntervention("cancel",{kind:"CANCEL",text:"算了"});
  assert.equal(out.action,"cancelled");
  assert.equal(out.outcome.label,"CANCELLED_BY_USER");
  assert.equal(goals.runtime.devices[key("客厅","窗户")].slots.opening,20);

  const trajectory=goals.exportTrajectory("cancel");
  assert.equal(trajectory.schema_version,"pi-home-trajectory-v1");
  assert.equal(trajectory.outcome.label,"CANCELLED_BY_USER");
  assert.equal(trajectory.summary.cancelled,true);
  assert.equal(trajectory.interventions[0].text,"算了");
}

async function takeoverStopsAutonomyWithoutRollback(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({id:"takeover",goal:{type:"comfort"},strategy:{name:"normal"},desired_state:desired()});
  await goals.applyAgentPatches("takeover",[patch("客厅","窗户","opening",60)],{turn_id:"goal:takeover:1"});

  const out=await goals.handleHumanIntervention("takeover",{kind:"TAKEOVER",text:"我自己来"});
  assert.equal(out.action,"handed_off");
  assert.equal(out.outcome.label,"HUMAN_TAKEOVER");
  assert.equal(goals.runtime.devices[key("客厅","窗户")].slots.opening,60);
  assert.equal(goals.getEpisode("takeover").status,"handed_off");

  const trajectory=goals.exportTrajectory("takeover");
  assert.equal(trajectory.summary.human_takeover,true);
  assert.equal(trajectory.final_device_state[key("客厅","窗户")].slots.opening,60);
}

async function autonomousTraceIsTrainingReady(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({id:"train",goal:{type:"comfort"},strategy:{name:"A"},desired_state:desired()});

  let i=0;
  const observations=[{kitchen:{co2:1200}},{kitchen:{co2:850}}];
  const out=await goals.runAutonomousEpisode("train",{
    observe:async()=>observations[Math.min(i++,1)],
    planner:async()=>({
      strategy:{name:"B"},
      patches:[patch("客厅","窗户","opening",55)]
    })
  });
  assert.equal(out.completed,true);

  const trajectory=goals.exportTrajectory("train");
  assert.equal(trajectory.outcome.label,"SUCCESS");
  assert.equal(trajectory.steps.length,2);
  assert.equal(trajectory.steps[0].observation.kitchen.co2,1200);
  assert.equal(trajectory.steps[0].proposal.patches[0].value,55);
  assert.equal(trajectory.steps[0].evaluation.deficits[0].id,"co2");
  assert.equal(trajectory.summary.physical_actions,1);
}

(async()=>{
  await correctionAndPreferenceBecomeStructuredData();
  await cancelCreatesTrainingOutcomeAndRollback();
  await takeoverStopsAutonomyWithoutRollback();
  await autonomousTraceIsTrainingReady();
  console.log(JSON.stringify({
    ok:true,
    contract:"structured intervention events + trainable trajectory export"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
