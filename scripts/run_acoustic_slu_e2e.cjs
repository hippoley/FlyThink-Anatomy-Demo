"use strict";

const fs=require("fs");
const readline=require("readline");
const {createCheckpointClient}=require("./stateful_checkpoint_trajectory.cjs");
const {MockThingDriver}=require("./physical_runtime.cjs");
const {StreamingHomeSession}=require("./streaming_slu_e2e.cjs");
const {
  AsrEventSequenceGuard,
  toStreamingSessionEvent
}=require("./asr_event_bridge.cjs");

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}

function loadRuntime(){
  const runtimeFile=arg("--runtime-json");
  if(runtimeFile)return JSON.parse(fs.readFileSync(runtimeFile,"utf8"));
  const benchmarkFile=arg("--benchmark");
  if(benchmarkFile){
    const data=JSON.parse(fs.readFileSync(benchmarkFile,"utf8"));
    const index=Number(arg("--trajectory-index")||0);
    const row=(data.trajectories||[])[index];
    if(!row)throw new Error("acoustic_benchmark_trajectory_not_found");
    return row.initial_runtime||{};
  }
  throw new Error("--runtime-json or --benchmark is required");
}

(async()=>{
  const client=createCheckpointClient({
    graph:arg("--graph"),
    judgement:arg("--judgement"),
    semantic:arg("--semantic")
  });
  const initialRuntime=loadRuntime();
  const driver=new MockThingDriver(initialRuntime);
  const session=new StreamingHomeSession({
    initialRuntime,
    predictor:client.predict,
    driver
  });
  const guard=new AsrEventSequenceGuard();
  const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  let events=0,finals=0;

  try{
    for await(const line of input){
      if(!line.trim())continue;
      const event=guard.accept(JSON.parse(line));
      const row=await session.process(toStreamingSessionEvent(event));
      events++;
      if(event.kind==="final")finals++;
      if(event.kind!=="final"&&row.committed){
        throw new Error("acoustic_speculative_event_committed");
      }
    }
  } finally {
    await client.close();
  }

  if(events===0)throw new Error("no_asr_events_received");
  if(finals===0)throw new Error("no_final_asr_event_received");

  const speculativePhysical=session.trace
    .filter(x=>!x.asr.is_final)
    .reduce((n,x)=>n+(x.physical_command_count_after-x.physical_command_count_before),0);

  const out={
    truth:"acoustic_asr_to_slu_runtime_v1",
    asr_events:events,
    final_segments:finals,
    speculative_physical_commands:speculativePhysical,
    physical_commands:driver.commands.length,
    runtime:session.runtime,
    trace:session.trace
  };
  console.log(JSON.stringify(out));
  if(speculativePhysical!==0)process.exitCode=2;
})().catch(e=>{console.error(e);process.exit(1)});
