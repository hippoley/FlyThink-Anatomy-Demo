"use strict";
const cp=require("child_process");
const readline=require("readline");
const {applyTurn,normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {deriveContext}=require("./runtime_context_adapter.cjs");
const {MockThingDriver,executePhysicalTurn}=require("./physical_runtime.cjs");

function key(t){return t&&[t.area,t.entity,t.instance||"default"].join("::")}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function semanticOk(p,t){
 if(!p)return false;
 if(t.gold_op&&p.op!==t.gold_op)return false;
 if(t.gold_slot!==undefined&&p.slot!==t.gold_slot)return false;
 if(t.gold_value!==undefined&&!eq(p.value,t.gold_value))return false;
 if(t.gold_delta!==undefined&&!eq(p.delta,t.gold_delta))return false;
 if(t.gold_slots!==undefined&&!eq(p.slots,t.gold_slots))return false;
 return true;
}
function sameTargets(p,gold){
 if(!gold)return true;
 const got=p&&p.target?[key(p.target)]:((p&&p.targets)||[]).map(key).sort();
 const exp=(Array.isArray(gold)?gold:[gold]).map(key).sort();
 return JSON.stringify(got)===JSON.stringify(exp);
}
async function run(trajectory,args={}){
 let runtime=normalizeRuntime(trajectory.initial_runtime||{}),history=[],unsafe=0,wrong=0,untouched=0,decisionCorrect=0,patchCorrect=0,stateCorrect=0;
 const physical=args.physical==="mock"?new MockThingDriver(runtime,args.physical_options||{}):null;
 const py=cp.spawn("python",["scripts/checkpoint_jsonl_server.py","--graph",args.graph,"--judgement",args.judgement,"--semantic",args.semantic],{stdio:["pipe","pipe","inherit"]});
 const rl=readline.createInterface({input:py.stdout});const queue=[];let serverError=null;
 py.on("exit",(code,signal)=>{if(code!==0){serverError=new Error("checkpoint_server_exit:"+code+":"+(signal||""));while(queue.length){const q=queue.shift();q.reject(serverError);}}});
 rl.on("line",l=>{const q=queue.shift();if(q){try{q.resolve(JSON.parse(l));}catch(e){q.reject(e);}}});
 const predict=x=>new Promise((resolve,reject)=>{if(serverError)return reject(serverError);queue.push({resolve,reject});py.stdin.write(JSON.stringify(x)+"\n",e=>{if(e)reject(e)});});
 for(const turn of trajectory.turns){
  const derived=deriveContext(runtime,history);const context={...derived,...(turn.context_hint||{})};
  const pred=await predict({text:turn.text,context,background:{...context,...(turn.background||{})}});
  let outcome=pred.decision,error=null,applied=[],physicalReceipts=[];
  if(outcome==="EXECUTE"){
   try{
    if(physical){
     const a=executePhysicalTurn(runtime,pred.patches||[],physical,{turn_id:history.length+1});
     runtime=a.runtime;physicalReceipts=a.receipts;
    }else{
     const a=applyTurn(runtime,pred.patches||[]);runtime=a.runtime;
    }
    applied=(pred.patches||[]);
   }
   catch(e){error=String(e.message);outcome=error.startsWith("protected_invariant_write")?"BLOCK":error.includes("requires_existing_value")?"CLARIFY":"INVALID";if(error.startsWith("untouched_state_mutation"))untouched++;}
  }
  if(outcome==="EXECUTE"&&turn.gold_decision!=="EXECUTE")unsafe++;
  if(outcome==="EXECUTE"&&turn.gold_target&&!sameTargets((pred.patches||[])[0],turn.gold_target))wrong++;
  const decisionOk=outcome===turn.gold_decision;if(decisionOk)decisionCorrect++;
  const pp=(pred.patches||[])[0];const semanticsOk=outcome!=="EXECUTE"||semanticOk(pp,turn);const targetOk=outcome!=="EXECUTE"||!turn.gold_target||sameTargets(pp,turn.gold_target);
  const ok=decisionOk&&semanticsOk&&targetOk;if(ok)patchCorrect++;
  let stateOk=true;if(turn.gold_state){
   const runtimeKeys=Object.keys(runtime.devices).sort(),goldKeys=Object.keys(turn.gold_state).sort();
   if(!eq(runtimeKeys,goldKeys))stateOk=false;
   if(stateOk)for(const [k,slots] of Object.entries(turn.gold_state)){const d=runtime.devices[k];if(!d||!eq(d.slots||{},slots)){stateOk=false;break}}
  }if(stateOk)stateCorrect++;
  history.push({text:turn.text,outcome,predicted:pred.decision,gold:turn.gold_decision,ok,state_ok:stateOk,error,applied_patches:applied,physical_receipts:physicalReceipts,context});
 }
 py.stdin.end();
 return {
  decision_exact:decisionCorrect/trajectory.turns.length,
  full_patch_exact:patchCorrect/trajectory.turns.length,
  state_after_turn_exact:stateCorrect/trajectory.turns.length,
  strict_trajectory_exact:patchCorrect===trajectory.turns.length&&stateCorrect===trajectory.turns.length,
  unsafe_execute:unsafe,wrong_device:wrong,untouched_state_violation:untouched,
  physical_mode:physical?"mock":"disabled",
  physical_commands:physical?physical.commands.length:0,
  runtime,turns:history
 };
}
module.exports={run};
