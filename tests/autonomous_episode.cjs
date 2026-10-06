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
      }
    }
  };
}

function desired(){
  return [
    {id:"co2",source:"observation",path:"kitchen.co2",op:"<",value:900}
  ];
}

async function actionBudgetMustBlockBeforePhysical(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({id:"budget",goal:{type:"comfort"},strategy:{name:"a"},desired_state:desired()});

  const out=await goals.runAutonomousEpisode("budget",{
    max_steps:3,
    max_actions:1,
    observe:async()=>({kitchen:{co2:1400}}),
    planner:async()=>({
      strategy:{name:"should-not-commit"},
      patches:[
        patch("客厅","窗户","opening",40),
        patch("客厅","窗户","opening",60)
      ]
    })
  });
  assert.equal(out.stop_reason,"action_budget_exceeded");
  assert.equal(out.outcome.label,"BUDGET_EXHAUSTED");
  assert.equal(out.actions,0);
  assert.equal(driver.commands.length,0);
  assert.equal(goals.runtime.devices[key("客厅","窗户")].slots.opening,20);
  assert.equal(goals.getEpisode("budget").strategy.name,"a");
}

async function stagnationMustStop(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({id:"stall",goal:{type:"comfort"},strategy:{name:"increase"},desired_state:desired()});

  let value=30;
  const out=await goals.runAutonomousEpisode("stall",{
    max_steps:6,
    max_actions:6,
    max_stagnant_steps:2,
    min_score_improvement:0.01,
    observe:async()=>({kitchen:{co2:1400}}),
    planner:async()=>({patches:[patch("客厅","窗户","opening",value+=10)]})
  });
  assert.equal(out.stop_reason,"progress_stalled");
  assert.equal(out.outcome.label,"STALLED");
  assert.equal(out.completed,false);
  assert.ok(out.actions>=2);
  assert.ok(out.actions<=3);
}

async function oscillationMustStop(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({id:"osc",goal:{type:"comfort"},strategy:{name:"A"},desired_state:desired()});

  let flip=false;
  const out=await goals.runAutonomousEpisode("osc",{
    max_steps:10,
    max_actions:10,
    max_stagnant_steps:99,
    max_oscillations:2,
    observe:async()=>({kitchen:{co2:1400}}),
    planner:async()=>{
      flip=!flip;
      return {
        strategy:{name:flip?"B":"A"},
        patches:[patch("客厅","窗户","opening",flip?40:20)]
      };
    }
  });
  assert.equal(out.stop_reason,"strategy_oscillation");
  assert.equal(out.outcome.label,"OSCILLATION");
  assert.equal(out.completed,false);
  assert.ok(out.steps<=5);
}

async function goalCompletionBeatsBudgets(){
  const initial=runtime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  goals.beginGoal({id:"done",goal:{type:"comfort"},strategy:{name:"A"},desired_state:desired()});
  const obs=[{kitchen:{co2:1200}},{kitchen:{co2:850}}];
  let i=0;
  const out=await goals.runAutonomousEpisode("done",{
    max_steps:4,
    max_actions:4,
    observe:async()=>obs[Math.min(i++,obs.length-1)],
    planner:async()=>({patches:[patch("客厅","窗户","opening",55)]})
  });
  assert.equal(out.completed,true);
  assert.equal(out.stop_reason,"goal_completed");
  assert.equal(out.outcome.label,"SUCCESS");
  assert.equal(out.outcome.intervention_recommended,false);
  assert.equal(out.actions,1);
}

(async()=>{
  await actionBudgetMustBlockBeforePhysical();
  await stagnationMustStop();
  await oscillationMustStop();
  await goalCompletionBeatsBudgets();
  console.log(JSON.stringify({
    ok:true,
    contract:"bounded autonomy: action budget + stagnation + oscillation + completion"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
