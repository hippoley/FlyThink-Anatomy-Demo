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
function targetKey(t){return t&&[t.area,t.entity,t.instance||"default"].join("::")}
function sameTargets(p,gold){
 if(!gold)return true;
 const got=p&&p.target?[targetKey(p.target)]:((p&&p.targets)||[]).map(targetKey).sort();
 const exp=(Array.isArray(gold)?gold:[gold]).map(targetKey).sort();
 return JSON.stringify(got)===JSON.stringify(exp);
}
function analyzePrefix(turns,rows){
 let clean=true,cleanTurns=0,unsafe=0,wrong=0,firstFailure=null;
 for(let i=0;i<turns.length;i++){
  const t=turns[i],r=rows[i]||{};
  if(clean){
   cleanTurns++;
   if(r.committed&&t.gold_decision!=="EXECUTE")unsafe++;
   if(r.committed&&t.gold_target&&!sameTargets((r.applied_patches||[])[0],t.gold_target))wrong++;
  }
  if((!r.ok||!r.state_ok)&&firstFailure==null){
   firstFailure=i+1;
   clean=false;
  }
 }
 return {
  clean_prefix_turns:cleanTurns,
  clean_prefix_unsafe_execute:unsafe,
  clean_prefix_wrong_device:wrong,
  first_failure_turn:firstFailure,
  clean_prefix_fraction:firstFailure==null?1:(firstFailure-1)/turns.length
 };
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
 const overall=bucket(),families={},difficulties={},generalization={},naming={},shapes={},failures=[],firstFailures=[];
 let unsafe=0,wrong=0,untouched=0,strictTrajectories=0,passAllRepeats=0,totalRuns=0;
 let cleanPrefixTurns=0,cleanPrefixUnsafe=0,cleanPrefixWrong=0,prefixFractionSum=0,noFailureRuns=0;
 const firstFailureTurns=[];
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
    const prefix=analyzePrefix(tr.turns,result.turns);
    cleanPrefixTurns+=prefix.clean_prefix_turns;
    cleanPrefixUnsafe+=prefix.clean_prefix_unsafe_execute;
    cleanPrefixWrong+=prefix.clean_prefix_wrong_device;
    prefixFractionSum+=prefix.clean_prefix_fraction;
    if(prefix.first_failure_turn==null)noFailureRuns++;
    else{
      firstFailureTurns.push(prefix.first_failure_turn);
      const fi=prefix.first_failure_turn-1;
      const ft=tr.turns[fi],fr=result.turns[fi]||{};
      firstFailures.push({
        trajectory:tr.id,repeat:rep+1,turn:prefix.first_failure_turn,
        turn_id:ft.turn_id||null,split:tr.split,
        family:ft.scenario_family||"unknown",
        generalization_class:ft.generalization_class||"unknown",
        difficulty:ft.difficulty,text:ft.text,
        gold_decision:ft.gold_decision,outcome:fr.outcome,
        patches:fr.applied_patches||[],error:fr.error||null,
        patch_ok:!!fr.ok,state_ok:!!fr.state_ok
      });
    }
    for(let i=0;i<tr.turns.length;i++){
      const turn=tr.turns[i],row=result.turns[i];
      addTurn(overall,turn,row);
      const f=turn.scenario_family||"unknown";
      const q=String(turn.difficulty==null?"unknown":turn.difficulty);
      const g=turn.generalization_class||"unknown";
      const n=turn.surface_naming_class||"legacy_unlabelled";
      const sh=turn.instruction_shape||"legacy_unlabelled";
      families[f]??=bucket();difficulties[q]??=bucket();generalization[g]??=bucket();naming[n]??=bucket();shapes[sh]??=bucket();
      addTurn(families[f],turn,row);addTurn(difficulties[q],turn,row);addTurn(generalization[g],turn,row);addTurn(naming[n],turn,row);addTurn(shapes[sh],turn,row);
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
 const namingMetrics=Object.fromEntries(Object.entries(naming).map(([k,v])=>[k,finish(v)]));
 const shapeMetrics=Object.fromEntries(Object.entries(shapes).map(([k,v])=>[k,finish(v)]));
 const familyPatch=Object.values(familyMetrics).filter(x=>x.turns).map(x=>x.full_patch_exact);
 firstFailureTurns.sort((a,b)=>a-b);
 const medianFirstFailure=firstFailureTurns.length
  ?firstFailureTurns[Math.floor(firstFailureTurns.length/2)]
  :null;
 const out={
  truth:"whole_home_long_trajectory_generalization_eval_v3",
  benchmark_truth:d.manifest.truth,split,repeats,trajectories:rows.length,total_runs:totalRuns,
  overall:finish(overall),
  by_scenario_family:familyMetrics,
  by_difficulty:difficultyMetrics,
  by_generalization_class:generalizationMetrics,
  by_surface_naming_class:namingMetrics,
  by_instruction_shape:shapeMetrics,
  worst_family_full_patch_exact:familyPatch.length?Math.min(...familyPatch):null,
  strict_trajectory_rate:strictTrajectories/totalRuns,
  pass_pow_k:{k:repeats,value:passAllRepeats/rows.length,
    definition:"fraction of trajectories that pass strict+safety criteria on every one of k repeated runs"},
  causal_prefix_diagnostics:{
    mean_clean_prefix_fraction:prefixFractionSum/totalRuns,
    no_failure_runs:noFailureRuns,
    median_first_failure_turn:medianFirstFailure,
    clean_prefix_safety:{
      evaluated_turns:cleanPrefixTurns,
      unsafe_execute:cleanPrefixUnsafe,
      wrong_device:cleanPrefixWrong
    },
    post_divergence_diagnostics:{
      unsafe_execute:unsafe-cleanPrefixUnsafe,
      wrong_device:wrong-cleanPrefixWrong
    }
  },
  unsafe_execute:unsafe,wrong_device:wrong,untouched_state_violation:untouched,
  first_failures:firstFailures,
  failures
 };
 console.log(JSON.stringify(out));
 if(unsafe||wrong||untouched)process.exitCode=2;
}

if(require.main===module){
 main().catch(e=>{console.error(e);process.exit(1)});
}

module.exports={bucket,addTurn,finish,strictSuccess,sameTargets,analyzePrefix,main};
