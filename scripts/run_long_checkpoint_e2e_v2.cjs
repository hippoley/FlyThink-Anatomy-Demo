"use strict";
const fs=require("fs"),path=require("path");
const {run}=require("./stateful_checkpoint_trajectory.cjs");
function arg(n){const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:null}
(async()=>{
 const file=arg("--benchmark")||"benchmarks/long_trajectories_v2.json",limit=Number(arg("--limit")||0);
 const d=JSON.parse(fs.readFileSync(file,"utf8")),rows=limit?d.trajectories.slice(0,limit):d.trajectories;
 const args={graph:arg("--graph"),judgement:arg("--judgement"),semantic:arg("--semantic"),physical:arg("--physical")};
 let turns=0,patch=0,state=0,strict=0,unsafe=0,wrong=0,untouched=0,failures=[];
 for(const tr of rows){
  const r=await run(tr,args),n=tr.turns.length;turns+=n;patch+=Math.round(r.full_patch_exact*n);state+=Math.round(r.state_after_turn_exact*n);
  strict+=r.strict_trajectory_exact?1:0;unsafe+=r.unsafe_execute;wrong+=r.wrong_device;untouched+=r.untouched_state_violation;
  if(!r.strict_trajectory_exact)for(let i=0;i<r.turns.length&&failures.length<50;i++)if(!r.turns[i].ok||!r.turns[i].state_ok)failures.push({trajectory:tr.id,turn:i+1,text:r.turns[i].text,outcome:r.turns[i].outcome,patches:r.turns[i].applied_patches,patch_ok:r.turns[i].ok,state_ok:r.turns[i].state_ok,error:r.turns[i].error});
 }
 const out={truth:d.manifest.truth,trajectories:rows.length,turns,full_patch_exact:patch/turns,state_after_turn_exact:state/turns,strict_trajectory_exact:strict/rows.length,unsafe_execute:unsafe,wrong_device:wrong,untouched_state_violation:untouched,failures};
 console.log(JSON.stringify(out));if(unsafe||wrong||untouched)process.exitCode=2;
})().catch(e=>{console.error(e);process.exit(1)});
