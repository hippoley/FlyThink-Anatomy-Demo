"use strict";

const assert=require("assert");
const {MockThingDriver}=require("../scripts/physical_runtime.cjs");
const {HomeGoalRuntime}=require("../scripts/home_goal_runtime.cjs");
const {evaluateDesiredState}=require("../scripts/desired_state_evaluator.cjs");

function target(area,entity){return {area,entity,instance:"default"}}
function key(area,entity){return area+"::"+entity+"::default"}
function patch(area,entity,slot,value){return {op:"PATCH_SLOT",target:target(area,entity),slot,value}}

function initialRuntime(){
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
  return [
    {id:"co2",source:"observation",path:"kitchen.co2",op:"<",value:900},
    {id:"temp",source:"observation",path:"kitchen.temperature",op:"between",min:25,max:27},
    {id:"rain-safe",source:"observation",path:"risk.rain_ingress",op:"==",value:false},
    {id:"window-bound",source:"device_slot",target:target("客厅","窗户"),slot:"opening",op:"<=",value:80}
  ];
}

async function evaluatorReportsDeficits(){
  const runtime=initialRuntime();
  const result=evaluateDesiredState(desired(),{
    runtime,
    observation:{kitchen:{co2:1080,temperature:27.8},risk:{rain_ingress:false}}
  });
  assert.equal(result.satisfied,false);
  assert.deepEqual(result.deficits.map(x=>x.id),["co2","temp"]);
  assert.equal(result.clauses.find(x=>x.id==="window-bound").actual,20);
}

async function missingEvidenceMustBlockAutonomy(){
  const initial=initialRuntime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({
    id:"ventilation-missing",
    goal:{type:"comfort",room:"厨房"},
    strategy:{name:"quiet_cross_room"},
    desired_state:desired()
  });

  let plannerCalls=0;
  const result=await goals.recheckGoal("ventilation-missing",{
    observation:{kitchen:{temperature:26.2},risk:{rain_ingress:false}},
    planner:async()=>{plannerCalls++;return {patches:[patch("客厅","窗户","opening",75)]}}
  });
  assert.equal(result.completed,false);
  assert.equal(result.action_taken,false);
  assert.equal(result.blocked_reason,"required_observation_missing");
  assert.equal(plannerCalls,0);
  assert.equal(driver.commands.length,0);
  assert.deepEqual(result.evaluation.missing_required.map(x=>x.id),["co2"]);
}

async function unconfiguredGoalMustNotAutoComplete(){
  const initial=initialRuntime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({id:"no-desired",goal:{type:"comfort"}});
  const result=await goals.recheckGoal("no-desired",{observation:{}});
  assert.equal(result.completed,false);
  assert.equal(result.blocked_reason,"desired_state_not_configured");
  assert.equal(goals.getEpisode("no-desired").status,"active");
}

async function autonomousRecheckReachesGoal(){
  const initial=initialRuntime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({
    id:"ventilation-loop",
    goal:{type:"comfort",room:"厨房"},
    strategy:{name:"quiet_cross_room"},
    desired_state:desired(),
    constraints:{rain_ingress:false}
  });

  const first=await goals.recheckGoal("ventilation-loop",{
    observation:{kitchen:{co2:1080,temperature:27.8},risk:{rain_ingress:false}},
    planner:async({evaluation})=>{
      assert.deepEqual(evaluation.deficits.map(x=>x.id),["co2","temp"]);
      return {
        patches:[patch("客厅","窗户","opening",75)],
        strategy:{name:"quiet_cross_room_boost"}
      };
    }
  });
  assert.equal(first.completed,false);
  assert.equal(first.action_taken,true);
  assert.equal(first.runtime.devices[key("客厅","窗户")].slots.opening,75);

  const second=await goals.recheckGoal("ventilation-loop",{
    observation:{kitchen:{co2:860,temperature:26.6},risk:{rain_ingress:false}},
    planner:async()=>{throw new Error("planner_must_not_run_when_goal_satisfied")}
  });
  assert.equal(second.completed,true);
  assert.equal(second.action_taken,false);
  assert.equal(second.episode.status,"completed");
}

(async()=>{
  await evaluatorReportsDeficits();
  await missingEvidenceMustBlockAutonomy();
  await unconfiguredGoalMustNotAutoComplete();
  await autonomousRecheckReachesGoal();
  console.log(JSON.stringify({
    ok:true,
    contract:"desired-state evaluation + observe/compare/act/recheck loop"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
