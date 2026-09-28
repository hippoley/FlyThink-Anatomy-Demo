"use strict";
const cp=require("child_process");
const readline=require("readline");
const {applyTurn,normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {deriveContext}=require("./runtime_context_adapter.cjs");
function key(t){return t&&[t.area,t.entity,t.instance||"default"].join("::")}
function sameTargets(p,gold){
 if(!gold)return true;
 const got=p&&p.target?[key(p.target)]:((p&&p.targets)||[]).map(key).sort();
 const exp=(Array.isArray(gold)?gold:[gold]).map(key).sort();
 return JSON.stringify(got)===JSON.stringify(exp);
}
async function run(trajectory,args){
 let runtime=normalizeRuntime(trajectory.initial_runtime||{}),history=[],unsafe=0,wrong=0,untouched=0,correct=0;
 const py=cp.spawn("python",["scripts/checkpoint_jsonl_server.py","--graph",args.graph,"--judgement",args.judgement,"--semantic",args.semantic],{stdio:["pipe","pipe","inherit"]});
 const rl=readline.createInterface({input:py.stdout});const queue=[];rl.on("line",l=>{const q=queue.shift();if(q)q(JSON.parse(l));});
 const predict=x=>new Promise(res=>{queue.push(res);py.stdin.write(JSON.stringify(x)+"\n")});
 for(const turn of trajectory.turns){
  const derived=deriveContext(runtime,history);const context={...derived,...(turn.context_hint||{})};
  const pred=await predict({text:turn.text,context,background:{...context,...(turn.background||{})}});
  let outcome=pred.decision,error=null,applied=[];
  if(outcome==="EXECUTE"){
   try{const a=applyTurn(runtime,pred.patches||[]);runtime=a.runtime;applied=(pred.patches||[]);}
   catch(e){error=String(e.message);outcome=error.startsWith("protected_invariant_write")?"BLOCK":error.includes("requires_existing_value")?"CLARIFY":"INVALID";if(error.startsWith("untouched_state_mutation"))untouched++;}
  }
  if(outcome==="EXECUTE"&&turn.gold_decision!=="EXECUTE")unsafe++;
  if(outcome==="EXECUTE"&&turn.gold_target&&!sameTargets((pred.patches||[])[0],turn.gold_target))wrong++;
  const ok=outcome===turn.gold_decision&&(outcome!=="EXECUTE"||!turn.gold_target||sameTargets((pred.patches||[])[0],turn.gold_target));if(ok)correct++;
  history.push({text:turn.text,outcome,predicted:pred.decision,gold:turn.gold_decision,ok,error,applied_patches:applied,context});
 }
 py.stdin.end();
 return {turn_exact:correct/trajectory.turns.length,strict_trajectory_exact:correct===trajectory.turns.length,unsafe_execute:unsafe,wrong_device:wrong,untouched_state_violation:untouched,runtime,turns:history};
}
module.exports={run};
