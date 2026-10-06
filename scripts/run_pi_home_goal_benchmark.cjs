"use strict";

const fs=require("fs");
const {MockThingDriver}=require("./physical_runtime.cjs");
const {HomeGoalRuntime}=require("./home_goal_runtime.cjs");

function arg(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null}
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

function plannerFor(scenario,step){
  if(scenario.id==="cooking-rain-noise"){
    if(step===0){
      return {
        patches:[
          patch("客厅","窗户","opening",55),
          patch("厨房","油烟机","level",3)
        ],
        strategy:{name:"cross_room_ventilation"}
      };
    }
    if(step===1){
      return {
        patches:[
          patch("厨房","油烟机","level",2),
          patch("客厅","窗户","opening",75)
        ],
        strategy:{name:"quiet_cross_room_ventilation"},
        reason:"noise_feedback",
        feedback:{text:"有点吵",dimension:"noise",sentiment:"negative"}
      };
    }
  }
  return {patches:[]};
}

async function runScenario(scenario){
  const initial=initialRuntime();
  const driver=new MockThingDriver(initial);
  const goals=new HomeGoalRuntime({initialRuntime:initial,driver});
  const id="bench:"+scenario.id;
  goals.beginGoal({
    id,
    goal:scenario.goal,
    strategy:scenario.strategy,
    desired_state:scenario.desired_state
  });

  const rows=[];
  let plannerCalls=0;
  for(let i=0;i<(scenario.observations||[]).length;i++){
    const observation=scenario.observations[i];
    const row=await goals.recheckGoal(id,{
      observation,
      turn_id:id+":"+String(i+1),
      planner:async input=>{
        plannerCalls++;
        return plannerFor(scenario,i,input);
      }
    });
    rows.push({
      step:i,
      completed:row.completed,
      action_taken:row.action_taken,
      blocked_reason:row.blocked_reason||null,
      score:row.evaluation&&row.evaluation.score,
      deficits:row.evaluation?row.evaluation.deficits.map(x=>x.id):[]
    });
    if(row.completed)break;
  }

  const episode=goals.getEpisode(id);
  const strategySwitch=!!(episode&&Array.isArray(episode.strategy_history)&&
    episode.strategy_history.some(x=>x.from&&x.to&&x.from.name!==x.to.name));
  return {
    id:scenario.id,
    completed:!!(episode&&episode.status==="completed"),
    status:episode&&episode.status,
    strategy_switch:strategySwitch,
    planner_calls:plannerCalls,
    physical_commands:driver.commands.length,
    blocked_reason:rows.length?rows[rows.length-1].blocked_reason:null,
    final_window:goals.runtime.devices[key("客厅","窗户")].slots.opening,
    final_hood:goals.runtime.devices[key("厨房","油烟机")].slots.level,
    rows
  };
}

(async()=>{
  const path=arg("--benchmark")||"benchmarks/pi_home_goal_scenarios.json";
  const data=JSON.parse(fs.readFileSync(path,"utf8"));
  const results=[];
  for(const scenario of data.scenarios||[])results.push(await runScenario(scenario));

  const missing=results.find(x=>x.id==="missing-co2-fail-closed");
  const satisfied=results.find(x=>x.id==="already-satisfied-no-action");
  const cooking=results.find(x=>x.id==="cooking-rain-noise");
  const out={
    benchmark:data.version,
    scenarios:results.length,
    goal_completion_rate:results.filter(x=>x.completed).length/results.length,
    unsafe_missing_evidence_actions:missing?missing.physical_commands:0,
    already_satisfied_extra_actions:satisfied?satisfied.physical_commands:0,
    strategy_switch_exact:!!(cooking&&cooking.strategy_switch),
    cooking_goal_completed:!!(cooking&&cooking.completed),
    results
  };
  console.log(JSON.stringify(out,null,2));

  if(!cooking||!cooking.completed||!cooking.strategy_switch)process.exitCode=2;
  if(!missing||missing.blocked_reason!=="required_observation_missing"||missing.physical_commands!==0)process.exitCode=2;
  if(!satisfied||!satisfied.completed||satisfied.physical_commands!==0)process.exitCode=2;
})().catch(e=>{console.error(e);process.exit(1)});
