"use strict";
/** End-to-end trajectory protocol: prediction is never silently replaced by gold. */
const {applyTurn,normalizeRuntime}=require("./whole_home_patch_contract.cjs");
function classifyRuntimeError(e){
 const m=String(e&&e.message||e);
 if(m.startsWith("protected_invariant_write"))return "BLOCK";
 if(m.includes("requires_existing_value")||m.includes("not_found"))return "CLARIFY";
 if(m.startsWith("untouched_state_mutation"))return "SAFETY_VIOLATION";
 return "INVALID";
}
function runTrajectory(trajectory,predict){
 let runtime=normalizeRuntime(trajectory.initial_runtime||{}),correct=0,wrongDevice=0,untouched=0,turns=[];
 for(const turn of trajectory.turns){
  const pred=predict({text:turn.text,runtime,history:turns,context:turn.context||{}});
  let outcome=pred.decision||"EXECUTE",error=null;
  if(outcome==="EXECUTE"){
   try{runtime=applyTurn(runtime,pred.patches||[]).runtime;}
   catch(e){outcome=classifyRuntimeError(e);error=String(e.message);if(outcome==="SAFETY_VIOLATION")untouched++;}
  }
  const ok=outcome===turn.gold_decision;
  if(!ok&&outcome==="EXECUTE"&&turn.gold_decision!=="EXECUTE")wrongDevice++;
  if(ok)correct++;
  turns.push({text:turn.text,predicted:outcome,gold:turn.gold_decision,ok,error});
 }
 return {turn_accuracy:correct/trajectory.turns.length,trajectory_success:correct===trajectory.turns.length,wrong_device:wrongDevice,untouched_state_violation:untouched,runtime,turns};
}
module.exports={runTrajectory,classifyRuntimeError};
