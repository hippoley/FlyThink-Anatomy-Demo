"use strict";
const fs=require("fs");
const {run}=require("./stateful_checkpoint_trajectory.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function goldPatch(t){
 if(t.gold_decision!=="EXECUTE")return null;
 const p={op:t.gold_op};
 if(Array.isArray(t.gold_target))p.targets=clone(t.gold_target);
 else p.target=clone(t.gold_target);
 if(t.gold_slot!==undefined)p.slot=t.gold_slot;
 if(t.gold_value!==undefined)p.value=clone(t.gold_value);
 if(t.gold_delta!==undefined)p.delta=t.gold_delta;
 if(t.gold_slots!==undefined)p.slots=clone(t.gold_slots);
 return p;
}
async function validate(path){
 const d=JSON.parse(fs.readFileSync(path,"utf8"));
 let trajectories=0,turns=0;
 for(const tr of d.trajectories){
  const queue=[...tr.turns];
  const predictor=async req=>{
   const t=queue.shift();
   if(!t)throw new Error("oracle_predictor_turn_underflow");
   if(req.text!==t.text)throw new Error("oracle_predictor_text_order_mismatch");
   return t.gold_decision==="EXECUTE"
    ?{decision:"EXECUTE",patches:[goldPatch(t)]}
    :{decision:t.gold_decision,patches:[]};
  };
  const out=await run(tr,{predictor});
  trajectories++;turns+=tr.turns.length;
  if(out.decision_exact!==1||out.full_patch_exact!==1||out.state_after_turn_exact!==1||
     out.strict_trajectory_exact!==true||out.unsafe_execute!==0||out.wrong_device!==0||
     out.untouched_state_violation!==0){
    throw new Error("benchmark_v3_oracle_not_executable:"+tr.id+":"+JSON.stringify(out.turns.filter(x=>!x.ok||!x.state_ok).slice(0,3)));
  }
 }
 return {ok:true,trajectories,turns,contract:"all V3 gold decisions/patches are executable by the canonical stateful benchmark runner"};
}
if(require.main===module){
 validate(process.argv[2]||"/tmp/long_trajectories_v3.json")
  .then(x=>console.log(JSON.stringify(x)))
  .catch(e=>{console.error(e);process.exit(1)});
}
module.exports={goldPatch,validate};
