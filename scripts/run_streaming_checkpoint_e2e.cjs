"use strict";

const fs=require("fs");
const {createCheckpointClient}=require("./stateful_checkpoint_trajectory.cjs");
const {MockThingDriver}=require("./physical_runtime.cjs");
const {StreamingHomeSession}=require("./streaming_slu_e2e.cjs");

function arg(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null}
function numArg(name,fallback){const v=arg(name);return v==null?fallback:Number(v)}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function key(t){return t&&[t.area,t.entity,t.instance||"default"].join("::")}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b)}

function splitHypotheses(text){
  const chars=Array.from(String(text));
  if(chars.length<=2)return [
    {kind:"partial",text:chars[0]||text},
    {kind:"stable",text:text},
    {kind:"final",text:text}
  ];
  const p=Math.max(1,Math.floor(chars.length*.4));
  const s=Math.max(p,Math.min(chars.length-1,Math.floor(chars.length*.75)));
  return [
    {kind:"partial",text:chars.slice(0,p).join("")},
    {kind:"stable",text:chars.slice(0,s).join("")},
    {kind:"final",text}
  ];
}

function sameTargets(p,gold){
  if(!gold)return true;
  const got=p&&p.target?[key(p.target)]:((p&&p.targets)||[]).map(key).sort();
  const exp=(Array.isArray(gold)?gold:[gold]).map(key).sort();
  return JSON.stringify(got)===JSON.stringify(exp);
}

function semanticOk(p,t){
  if(!p)return false;
  if(t.gold_op&&p.op!==t.gold_op)return false;
  if(t.gold_slot!==undefined&&!eq(p.slot,t.gold_slot))return false;
  if(t.gold_value!==undefined&&!eq(p.value,t.gold_value))return false;
  if(t.gold_delta!==undefined&&!eq(p.delta,t.gold_delta))return false;
  if(t.gold_slots!==undefined&&!eq(p.slots,t.gold_slots))return false;
  return sameTargets(p,t.gold_target);
}

function stateOk(runtime,gold){
  if(!gold)return true;
  const devices=runtime.devices||{};
  const runtimeKeys=Object.keys(devices).sort();
  const goldKeys=Object.keys(gold).sort();
  if(!eq(runtimeKeys,goldKeys))return false;
  for(const [k,slots] of Object.entries(gold)){
    if(!devices[k]||!eq(devices[k].slots||{},slots))return false;
  }
  return true;
}

(async()=>{
  const benchmark=arg("--benchmark")||"benchmarks/long_trajectories_v2.json";
  const d=JSON.parse(fs.readFileSync(benchmark,"utf8"));
  const trajectory=d.trajectories[0];
  if(!trajectory)throw new Error("streaming_benchmark_has_no_trajectory");
  const turnLimit=Math.min(numArg("--turns",8),trajectory.turns.length);
  const client=createCheckpointClient({
    graph:arg("--graph"),
    judgement:arg("--judgement"),
    semantic:arg("--semantic")
  });
  const driver=new MockThingDriver(trajectory.initial_runtime||{});
  const session=new StreamingHomeSession({
    initialRuntime:trajectory.initial_runtime||{},
    predictor:client.predict,
    driver
  });

  let finalPatch=0,finalState=0,finalDecision=0;
  let speculativeEvents=0;
  const failures=[];
  try{
    for(let i=0;i<turnLimit;i++){
      const turn=trajectory.turns[i];
      const events=splitHypotheses(turn.text);
      for(const e of events){
        const row=await session.process({
          turn_id:"checkpoint:"+String(i+1),
          kind:e.kind,
          text:e.text,
          background:turn.background||{}
        });
        if(e.kind!=="final"){
          speculativeEvents++;
          if(row.committed||row.physical_command_count_after!==row.physical_command_count_before){
            throw new Error("speculative_streaming_event_crossed_commit_boundary");
          }
        }else{
          const patch=row.patch_proposal[0];
          const decisionOk=row.semantic.decision===turn.gold_decision;
          const patchOk=turn.gold_decision!=="EXECUTE"||semanticOk(patch,turn);
          const sOk=stateOk(session.runtime,turn.gold_state);
          if(decisionOk)finalDecision++;
          if(decisionOk&&patchOk)finalPatch++;
          if(sOk)finalState++;
          if(!(decisionOk&&patchOk&&sOk)){
            failures.push({
              turn:i+1,text:turn.text,
              decision:row.semantic.decision,
              patch:clone(patch),
              decision_ok:decisionOk,
              patch_ok:patchOk,
              state_ok:sOk
            });
          }
        }
      }
    }
  } finally {
    await client.close();
  }

  const finalTraces=session.trace.filter(x=>x.asr.is_final);
  const stageComplete=session.trace.every(x=>
    x.asr&&x.semantic&&x.target_resolution&&
    Array.isArray(x.patch_proposal)&&x.commit_gate&&
    Array.isArray(x.thing_model)&&Array.isArray(x.feedback)&&x.reconcile
  );
  const out={
    truth:"p0_streaming_checkpoint_e2e_v1",
    source_trajectory:trajectory.id,
    final_turns:turnLimit,
    hypotheses:session.trace.length,
    speculative_events:speculativeEvents,
    final_decision_exact:finalDecision/turnLimit,
    final_patch_exact:finalPatch/turnLimit,
    final_state_after_turn_exact:finalState/turnLimit,
    stage_trace_complete:stageComplete,
    physical_commands:driver.commands.length,
    final_commits:finalTraces.filter(x=>x.committed).length,
    speculative_physical_commands:session.trace
      .filter(x=>!x.asr.is_final)
      .reduce((n,x)=>n+(x.physical_command_count_after-x.physical_command_count_before),0),
    failures,
    trace:session.trace
  };
  console.log(JSON.stringify(out));

  if(!stageComplete||
     out.speculative_physical_commands!==0||
     out.final_decision_exact!==1||
     out.final_patch_exact!==1||
     out.final_state_after_turn_exact!==1){
    process.exitCode=2;
  }
})().catch(e=>{console.error(e);process.exit(1)});
