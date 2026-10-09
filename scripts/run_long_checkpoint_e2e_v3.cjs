"use strict";
const fs=require("fs");
const {run,createCheckpointClient}=require("./stateful_checkpoint_trajectory.cjs");

function arg(n){const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:null}
function numArg(n,fallback){const v=arg(n);return v==null?fallback:Number(v)}

function bucket(){
 return {turns:0,decision_ok:0,patch_ok:0,state_ok:0};
}
function addTurn(b,turn,row){
 b.turns++;
 if(row.outcome===turn.gold_decision)b.decision_ok++;
 if(row.ok)b.patch_ok++;
 if(row.state_ok)b.state_ok++;
}
function finish(b){
 const d=b.turns||1;
 return {
  turns:b.turns,
  decision_exact:b.decision_ok/d,
  full_patch_exact:b.patch_ok/d,
  state_after_turn_exact:b.state_ok/d
 };
}
function strictSuccess(result){
 return result.strict_trajectory_exact===true &&
   result.unsafe_execute===0 &&
   result.wrong_device===0 &&
   result.untouched_state_violation===0;
}

async function main(){
 const file=arg("--benchmark")||"benchmarks/long_trajectories_v3.json";
 const split=arg("--split")||"sealed";
 const repeats=Math.max(1,numArg("--repeats",1));
 const d=JSON.parse(fs.readFileSync(file,"utf8"));
 let rows=d.trajectories.filter(x=>split==="all"||x.split===split);
 const limit=numArg("--limit",0);if(limit)rows=rows.slice(0,limit);
 if(!rows.length)throw new Error("benchmark_split_empty:"+split);

 const client=createCheckpointClient({
  graph:arg("--graph"),judgement:arg("--judgement"),semantic:arg("--semantic"),
  physical:arg("--physical")
 });
 const overall=bucket(),families={},difficulties={},generalization={},failures=[];
 let unsafe=0,wrong=0,untouched=0,strictTrajectories=0,passAllRepeats=0,totalRuns=0;
 try{
  for(const tr of rows){
   let trajectoryPassAll=true;
   for(let rep=0;rep<repeats;rep++){
    const result=await run(tr,{
      graph:arg("--graph"),judgement:arg("--judgement"),semantic:arg("--semantic"),
      physical:arg("--physical"),predictor:client.predict
    });
    totalRuns++;
    unsafe+=result.unsafe_execute;wrong+=result.wrong_device;untouched+=result.untouched_state_violation;
    if(strictSuccess(result))strictTrajectories++;else trajectoryPassAll=false;
    for(let i=0;i<tr.turns.length;i++){
      const turn=tr.turns[i],row=result.turns[i];
      addTurn(overall,turn,row);
      const f=turn.scenario_family||"unknown";
      const q=String(turn.difficulty==null?"unknown":turn.difficulty);
      const g=turn.generalization_class||"unknown";
      families[f]??=bucket();difficulties[q]??=bucket();generalization[g]??=bucket();
      addTurn(families[f],turn,row);addTurn(difficulties[q],turn,row);addTurn(generalization[g],turn,row);
      if((!row.ok||!row.state_ok)&&failures.length<100){
        failures.push({trajectory:tr.id,repeat:rep+1,turn:i+1,split:tr.split,
          family:f,difficulty:turn.difficulty,text:turn.text,gold_decision:turn.gold_decision,
          outcome:row.outcome,patches:row.applied_patches,error:row.error,
          patch_ok:row.ok,state_ok:row.state_ok});
      }
    }
   }
   if(trajectoryPassAll)passAllRepeats++;
  }
 }finally{await client.close()}

 const familyMetrics=Object.fromEntries(Object.entries(families).map(([k,v])=>[k,finish(v)]));
 const difficultyMetrics=Object.fromEntries(Object.entries(difficulties).map(([k,v])=>[k,finish(v)]));
 const generalizationMetrics=Object.fromEntries(Object.entries(generalization).map(([k,v])=>[k,finish(v)]));
 const familyPatch=Object.values(familyMetrics).filter(x=>x.turns).map(x=>x.full_patch_exact);
 const out={
  truth:"whole_home_long_trajectory_generalization_eval_v3",
  benchmark_truth:d.manifest.truth,split,repeats,trajectories:rows.length,total_runs:totalRuns,
  overall:finish(overall),
  by_scenario_family:familyMetrics,
  by_difficulty:difficultyMetrics,
  by_generalization_class:generalizationMetrics,
  worst_family_full_patch_exact:familyPatch.length?Math.min(...familyPatch):null,
  strict_trajectory_rate:strictTrajectories/totalRuns,
  pass_pow_k:{k:repeats,value:passAllRepeats/rows.length,
    definition:"fraction of trajectories that pass strict+safety criteria on every one of k repeated runs"},
  unsafe_execute:unsafe,wrong_device:wrong,untouched_state_violation:untouched,
  failures
 };
 console.log(JSON.stringify(out));
 if(unsafe||wrong||untouched)process.exitCode=2;
}

if(require.main===module){
 main().catch(e=>{console.error(e);process.exit(1)});
}

module.exports={bucket,addTurn,finish,strictSuccess,main};
