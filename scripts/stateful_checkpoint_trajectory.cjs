"use strict";
const cp=require("child_process");
const readline=require("readline");
const {applyTurn,normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {deriveContext}=require("./runtime_context_adapter.cjs");
const {
 MockThingDriver,
 executePhysicalTurn,
 evaluateQuarantinePreflight
}=require("./physical_runtime.cjs");
const {WindowPilotHttpDriver}=require("./windowpilot_http_driver.cjs");
const {evaluateCommit}=require("./commit_gate.cjs");

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
function physicalReceiptsApplied(receipts){
 return Array.isArray(receipts)&&receipts.length>0&&receipts.every(
  x=>x&&(x.local_only===true||x.status==="applied")
 );
}
function physicalReceiptFailure(receipts){
 const failed=(receipts||[]).filter(
  x=>!x||(x.local_only!==true&&x.status!=="applied")
 );
 if(!failed.length)return null;
 return "physical_receipt_not_applied:"+failed.map(
  x=>x&&x.status||"missing_status"
 ).join(",");
}

function createCheckpointClient(args={}){
 const py=cp.spawn("python",[
  "scripts/checkpoint_jsonl_server.py",
  "--graph",args.graph,
  "--judgement",args.judgement,
  "--semantic",args.semantic
 ],{stdio:["pipe","pipe","inherit"]});
 const rl=readline.createInterface({input:py.stdout});
 const queue=[];
 let serverError=null,closed=false;
 let resolveExit;
 const exited=new Promise(resolve=>{resolveExit=resolve});

 py.on("exit",(code,signal)=>{
  if(code!==0)serverError=new Error("checkpoint_server_exit:"+code+":"+(signal||""));
  else if(queue.length)serverError=new Error("checkpoint_server_exit_with_pending_requests");
  if(serverError){
   while(queue.length){
    const q=queue.shift();
    q.reject(serverError);
   }
  }
  resolveExit({code,signal});
 });
 py.on("error",err=>{
  serverError=err;
  while(queue.length){
   const q=queue.shift();
   q.reject(err);
  }
 });
 rl.on("line",line=>{
  const q=queue.shift();
  if(!q)return;
  try{q.resolve(JSON.parse(line));}
  catch(e){q.reject(e);}
 });

 const predict=x=>new Promise((resolve,reject)=>{
  if(serverError)return reject(serverError);
  if(closed)return reject(new Error("checkpoint_client_closed"));
  const request={resolve,reject};
  queue.push(request);
  py.stdin.write(JSON.stringify(x)+"\n",err=>{
   if(!err)return;
   const i=queue.indexOf(request);
   if(i>=0)queue.splice(i,1);
   reject(err);
  });
 });

 const close=async()=>{
  if(!closed){
   closed=true;
   py.stdin.end();
  }
  await exited;
  rl.close();
  if(serverError)throw serverError;
 };

 return {predict,close,process:py};
}

async function run(trajectory,args={}){
 let runtime=normalizeRuntime(trajectory.initial_runtime||{}),history=[],unsafe=0,wrong=0,untouched=0,deferred=0,decisionCorrect=0,patchCorrect=0,stateCorrect=0;
 let physical=null;
 if(args.physical==="mock")physical=new MockThingDriver(runtime,args.physical_options||{});
 else if(args.physical==="windowpilot")physical=new WindowPilotHttpDriver({
  baseUrl:args.windowpilot_url,
  target:args.physical_target,
  expectedHardwareIdentity:args.expected_hardware_identity||null,
  tolerancePct:args.position_tolerance_pct,
  timeoutMs:args.physical_timeout_ms
 });
 else if(args.physical)throw new Error("unsupported_physical_driver:"+args.physical);

 const ownedClient=args.predictor?null:createCheckpointClient(args);
 const predict=args.predictor||(x=>ownedClient.predict(x));

 try{
  for(const turn of trajectory.turns){
   const derived=deriveContext(runtime,history);const context={...derived,...(turn.context_hint||{})};
   const pred=await predict({text:turn.text,context,background:{...context,...(turn.background||{})}});
   let outcome=pred.decision,error=null,applied=[],physicalReceipts=[],committed=false;
   const commitGate=evaluateCommit({
    decision:pred.decision,
    patches:pred.patches||[],
    commit_state:turn.commit_state||context.commit_state||"safe_to_commit"
   });
   if(outcome==="EXECUTE"&&commitGate.deferred)deferred++;
   if(outcome==="EXECUTE"&&commitGate.allow){
    try{
     if(physical){
      const preflight=evaluateQuarantinePreflight(runtime,pred.patches||[]);
      if(!preflight.allow){
       const keys=preflight.violations.map(x=>x.device_key).join(",");
       applied=[];
       committed=false;
       error="semantic_preflight_blocked:device_quarantined:"+keys;
       outcome="BLOCK";
      }else{
       const a=await executePhysicalTurn(runtime,pred.patches||[],physical,{turn_id:history.length+1});
       runtime=a.runtime;physicalReceipts=a.receipts;
       committed=physicalReceiptsApplied(physicalReceipts);
       if(committed){
        applied=(pred.patches||[]);
       }else{
        applied=[];
        error=physicalReceiptFailure(physicalReceipts)||"physical_commit_has_no_applied_receipt";
        outcome="INVALID";
       }
      }
     }else{
      const a=applyTurn(runtime,pred.patches||[]);runtime=a.runtime;
      applied=(pred.patches||[]);committed=true;
     }
    }
    catch(e){error=String(e.message);outcome=error.startsWith("protected_invariant_write")?"BLOCK":error.includes("requires_existing_value")?"CLARIFY":"INVALID";if(error.startsWith("untouched_state_mutation"))untouched++;}
   }
   if(committed&&turn.gold_decision!=="EXECUTE")unsafe++;
   if(committed&&turn.gold_target&&!sameTargets((pred.patches||[])[0],turn.gold_target))wrong++;
   const decisionOk=outcome===turn.gold_decision;if(decisionOk)decisionCorrect++;
   const pp=(pred.patches||[])[0];const semanticsOk=outcome!=="EXECUTE"||semanticOk(pp,turn);const targetOk=outcome!=="EXECUTE"||!turn.gold_target||sameTargets(pp,turn.gold_target);
   const ok=decisionOk&&semanticsOk&&targetOk;if(ok)patchCorrect++;
   let stateOk=true;if(turn.gold_state){
    const runtimeKeys=Object.keys(runtime.devices).sort(),goldKeys=Object.keys(turn.gold_state).sort();
    if(!eq(runtimeKeys,goldKeys))stateOk=false;
    if(stateOk)for(const [k,slots] of Object.entries(turn.gold_state)){const d=runtime.devices[k];if(!d||!eq(d.slots||{},slots)){stateOk=false;break}}
   }if(stateOk)stateCorrect++;
   history.push({text:turn.text,outcome,predicted:pred.decision,gold:turn.gold_decision,ok,state_ok:stateOk,error,committed,commit_gate:commitGate,applied_patches:applied,physical_receipts:physicalReceipts,context});
  }
 } finally {
  if(ownedClient)await ownedClient.close();
 }

 return {
  decision_exact:decisionCorrect/trajectory.turns.length,
  full_patch_exact:patchCorrect/trajectory.turns.length,
  state_after_turn_exact:stateCorrect/trajectory.turns.length,
  strict_trajectory_exact:patchCorrect===trajectory.turns.length&&stateCorrect===trajectory.turns.length,
  unsafe_execute:unsafe,wrong_device:wrong,untouched_state_violation:untouched,deferred_commit:deferred,
  physical_mode:physical?(args.physical||"custom"):"disabled",
  physical_commands:physical?physical.commands.length:0,
  runtime,turns:history
 };
}
module.exports={
 run,
 createCheckpointClient,
 physicalReceiptsApplied,
 physicalReceiptFailure
};
