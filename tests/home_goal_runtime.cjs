"use strict";

const assert=require("assert");
const {MockThingDriver}=require("../scripts/physical_runtime.cjs");
const {HomeGoalRuntime}=require("../scripts/home_goal_runtime.cjs");
const {deriveContext}=require("../scripts/runtime_context_adapter.cjs");

function target(area,entity){return {area,entity,instance:"default"}}
function key(area,entity){return area+"::"+entity+"::default"}

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
      },
      [key("厨房","灯")]:{
        key:key("厨房","灯"),area:"厨房",entity:"灯",instance:"default",
        status:"mounted",model_id:"LIGHT_GROUP",slots:{brightness:30}
      }
    }
  };
}

function patch(area,entity,slot,value){
  return {op:"PATCH_SLOT",target:target(area,entity),slot,value};
}

async function strategyChangeAndCancelPreservesUserState(){
  const initial=initialRuntime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});

  goals.beginGoal({
    id:"ventilation-1",
    goal:{type:"comfort",room:"厨房"},
    strategy:{name:"cross_room_ventilation",priority:["air_quality"]},
    desired_state:{kitchen_co2:"<900"},
    constraints:{rain_ingress:false}
  });

  await goals.applyAgentPatches("ventilation-1",[
    patch("客厅","窗户","opening",55),
    patch("厨房","油烟机","level",3)
  ],{turn_id:"t1"});

  goals.updateStrategy(
    "ventilation-1",
    {name:"quiet_cross_room_ventilation",priority:["quiet","air_quality"]},
    {reason:"user_feedback",feedback:{text:"有点吵",dimension:"noise",sentiment:"negative"}}
  );

  await goals.applyAgentPatches("ventilation-1",[
    patch("厨房","油烟机","level",2),
    patch("客厅","窗户","opening",75)
  ],{turn_id:"t2"});

  // An unrelated user mutation during the goal must remain untouched.
  await goals.applyUserPatches("ventilation-1",[
    patch("厨房","灯","brightness",70)
  ],{turn_id:"user-1"});

  const context=deriveContext(goals.runtime,[]);
  assert.equal(context.active_goals.length,1);
  assert.equal(context.active_goals[0].id,"ventilation-1");
  assert.equal(context.active_goals[0].strategy.name,"quiet_cross_room_ventilation");

  const cancelled=await goals.cancelGoal("ventilation-1",{turn_id:"cancel-1"});
  assert.equal(cancelled.episode.status,"cancelled");
  assert.equal(cancelled.runtime.devices[key("客厅","窗户")].slots.opening,20);
  assert.equal(cancelled.runtime.devices[key("厨房","油烟机")].slots.level,2);
  assert.equal(cancelled.runtime.devices[key("厨房","灯")].slots.brightness,70);
  assert.ok(cancelled.compensation.some(x=>x.target.entity==="窗户"&&x.value===20));
  assert.ok(!cancelled.compensation.some(x=>x.target.entity==="灯"));
}

async function userOverrideOnAgentOwnedPathSurvivesCancel(){
  const initial=initialRuntime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({id:"ventilation-2",goal:{type:"comfort"},strategy:{name:"window"}});

  await goals.applyAgentPatches("ventilation-2",[
    patch("客厅","窗户","opening",55)
  ],{turn_id:"t1"});

  // User manually changes the very same path after the agent.
  await goals.applyUserPatches("ventilation-2",[
    patch("客厅","窗户","opening",40)
  ],{turn_id:"user-override"});

  const cancelled=await goals.cancelGoal("ventilation-2");
  assert.equal(cancelled.runtime.devices[key("客厅","窗户")].slots.opening,40);
  assert.equal(cancelled.compensation.length,0);
}

(async()=>{
  await strategyChangeAndCancelPreservesUserState();
  await userOverrideOnAgentOwnedPathSurvivesCancel();
  console.log(JSON.stringify({
    ok:true,
    contract:"goal + strategy steering + agent-owned rollback + user-state preservation"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
