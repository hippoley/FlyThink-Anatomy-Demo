"use strict";

const fs=require("fs");
const readline=require("readline");
const {createCheckpointClient}=require("./stateful_checkpoint_trajectory.cjs");
const {StreamingHomeSession}=require("./streaming_slu_e2e.cjs");
const {WindowPilotHttpDriver}=require("./windowpilot_http_driver.cjs");
const {normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {reconcileObservation}=require("./physical_runtime.cjs");
const {
  AsrEventSequenceGuard,
  toStreamingSessionEvent
}=require("./asr_event_bridge.cjs");
const {
  parseTarget,
  assertApplyPreconditions
}=require("./probe_windowpilot_checkpoint_e2e.cjs");
const {
  buildReceipt,
  validateReceipt
}=require("./acoustic_windowpilot_evidence.cjs");

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}
function flag(name){return process.argv.includes(name)}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function initialRuntimeFromPhysical(target,pct){
  const key=[target.area,target.entity,target.instance||"default"].join("::");
  return normalizeRuntime({devices:{
    [key]:{
      key,
      area:target.area,
      entity:target.entity,
      instance:target.instance||"default",
      status:"mounted",
      model_id:"CWDS-CA01",
      slots:{
        opening:pct,
        power:pct<=1?"OFF":"ON"
      }
    }
  }});
}

function assertLiveProbePreconditions({
  apply,
  target,
  probeOpenPct,
  tolerancePct,
  initialPct,
  expectedHardwareIdentity,
  readiness
}){
  if(target.entity!=="窗"&&target.entity!=="窗户"){
    throw new Error("windowpilot_live_probe_requires_window_target");
  }
  if(!Number.isFinite(probeOpenPct)||probeOpenPct<=0||probeOpenPct>5){
    throw new Error("windowpilot_live_probe_open_pct_must_be_gt0_lte5");
  }
  if(!Number.isFinite(tolerancePct)||tolerancePct<0||tolerancePct>2){
    throw new Error("windowpilot_live_probe_tolerance_invalid");
  }
  if(!Number.isFinite(initialPct)||initialPct<0||initialPct>100){
    throw new Error("windowpilot_live_probe_initial_position_invalid");
  }
  if(apply&&initialPct>tolerancePct){
    throw new Error(
      "windowpilot_live_probe_requires_initially_closed:"+
      String(initialPct)
    );
  }
  assertApplyPreconditions({
    apply,
    expectedHardwareIdentity,
    readiness
  });
}

async function closeout(driver,runtime,target,tolerancePct){
  const before=await driver.state();
  const beforePct=Number(before?.thing_model?.window_open_pct);
  if(!Number.isFinite(beforePct)){
    throw new Error("windowpilot_closeout_invalid_preclose_position");
  }
  if(beforePct<=tolerancePct){
    return {
      attempted:false,
      already_closed:true,
      before_position_pct:beforePct,
      after_position_pct:beforePct,
      receipt:null,
      runtime
    };
  }
  const receipt=await driver.execute({
    op:"PATCH_SLOT",
    target,
    slot:"opening",
    value:0
  });
  const observation=receipt&&receipt.observation;
  if(!observation){
    throw new Error("windowpilot_closeout_missing_observation");
  }
  const next=reconcileObservation(runtime,observation,"acoustic-live-closeout");
  const afterPct=Number(observation?.evidence?.position_pct);
  if(!Number.isFinite(afterPct)||afterPct>tolerancePct){
    throw new Error("windowpilot_closeout_not_observed_closed");
  }
  return {
    attempted:true,
    already_closed:false,
    before_position_pct:beforePct,
    after_position_pct:afterPct,
    receipt:clone(receipt),
    runtime:next
  };
}

async function main(){
  const url=arg("--url");
  const target=parseTarget(arg("--target-json"));
  const apply=flag("--apply");
  const expectedHardwareIdentity=arg("--expected-hardware-identity")||null;
  const probeOpenPct=Number(arg("--probe-open-pct")||5);
  const tolerancePct=Number(arg("--tolerance")||1);
  const timeoutMs=Number(arg("--timeout-ms")||5000);
  const receiptPath=arg("--receipt");
  const fixtureJson=arg("--acoustic-fixture-json");
  const acousticFixture=fixtureJson?JSON.parse(fixtureJson):null;

  if(!url)throw new Error("--url is required");
  if(apply&&!receiptPath)throw new Error("--apply requires --receipt");

  const driver=new WindowPilotHttpDriver({
    baseUrl:url,
    target,
    expectedHardwareIdentity,
    defaultOpenPct:probeOpenPct,
    maxOpenPct:probeOpenPct,
    tolerancePct,
    timeoutMs
  });

  const readiness=await driver.readiness();
  const physicalState=await driver.state();
  const initialPct=Number(physicalState?.thing_model?.window_open_pct);
  assertLiveProbePreconditions({
    apply,target,probeOpenPct,tolerancePct,initialPct,
    expectedHardwareIdentity,readiness
  });

  const initialRuntime=initialRuntimeFromPhysical(target,initialPct);
  const client=createCheckpointClient({
    graph:arg("--graph"),
    judgement:arg("--judgement"),
    semantic:arg("--semantic")
  });
  const session=new StreamingHomeSession({
    initialRuntime,
    predictor:client.predict,
    driver
  });
  const guard=new AsrEventSequenceGuard();
  const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  let events=0,finals=0;
  const acceptedEvents=[];
  let processingError=null;
  let closeoutEvidence=null;

  try{
    for await(const line of input){
      if(!line.trim())continue;
      const event=guard.accept(JSON.parse(line));
      acceptedEvents.push(clone(event));
      if(apply&&event.kind==="final"&&finals>=1){
        throw new Error("windowpilot_live_probe_allows_one_final_segment");
      }
      const sessionEvent=toStreamingSessionEvent(event);
      if(!apply&&event.kind==="final"){
        // Inspect the exact final semantic proposal without crossing the
        // physical boundary.
        sessionEvent.commit_state="tentative";
      }
      const row=await session.process(sessionEvent);
      events++;
      if(event.kind==="final")finals++;
      if(event.kind!=="final"&&row.committed){
        throw new Error("acoustic_speculative_event_committed");
      }
    }
  }catch(e){
    processingError=e;
  }finally{
    await client.close();
    if(apply){
      try{
        closeoutEvidence=await closeout(
          driver,session.runtime,target,tolerancePct
        );
        session.runtime=closeoutEvidence.runtime;
      }catch(closeErr){
        if(processingError){
          processingError=new Error(
            String(processingError.message||processingError)+
            "; closeout_failed:"+String(closeErr.message||closeErr)
          );
        }else{
          processingError=closeErr;
        }
      }
    }
  }

  if(processingError)throw processingError;
  if(events===0)throw new Error("no_asr_events_received");
  if(finals===0)throw new Error("no_final_asr_event_received");

  const speculativePhysical=session.trace
    .filter(x=>!x.asr.is_final)
    .reduce((n,x)=>n+(
      x.physical_command_count_after-x.physical_command_count_before
    ),0);
  const semanticCommands=session.trace
    .filter(x=>x.asr.is_final&&x.committed).length;

  const closeoutPublic=closeoutEvidence?{
    attempted:closeoutEvidence.attempted,
    already_closed:closeoutEvidence.already_closed,
    before_position_pct:closeoutEvidence.before_position_pct,
    after_position_pct:closeoutEvidence.after_position_pct,
    receipt:closeoutEvidence.receipt
  }:null;

  let evidenceReceipt=null;
  let evidenceValidation=null;
  if(apply){
    evidenceReceipt=buildReceipt({
      mode:"APPLY",
      target,
      probeOpenPct,
      tolerancePct,
      expectedHardwareIdentity,
      readiness,
      beforePositionPct:initialPct,
      acceptedEvents,
      trace:session.trace,
      driverCommands:driver.commands,
      closeout:closeoutPublic,
      runtime:session.runtime,
      acousticFixture
    });
    evidenceValidation=validateReceipt(evidenceReceipt,{
      requireHumanFixture:!!(
        acousticFixture&&acousticFixture.require_human_acceptance===true
      )
    });
    fs.writeFileSync(receiptPath,JSON.stringify(evidenceReceipt,null,2)+"\n");
  }

  const out={
    truth:"acoustic_windowpilot_live_probe_v1",
    mode:apply?"APPLY":"DRY_RUN",
    target,
    probe_open_pct:probeOpenPct,
    tolerance_pct:tolerancePct,
    readiness:{
      physical_write_ready:readiness.physical_write_ready,
      write_blockers:readiness.write_blockers||[],
      hardware_identity:readiness.hardware_identity||null
    },
    acoustic_fixture:clone(acousticFixture),
    before:{position_pct:initialPct},
    asr_events:events,
    final_segments:finals,
    speculative_physical_commands:speculativePhysical,
    semantic_commits:semanticCommands,
    physical_driver_commands:driver.commands.length,
    closeout:closeoutPublic,
    evidence_receipt:receiptPath||null,
    evidence_validation:evidenceValidation,
    runtime:session.runtime,
    trace:session.trace
  };
  console.log(JSON.stringify(out));

  if(speculativePhysical!==0)process.exitCode=2;
  if(!apply&&driver.commands.length!==0)process.exitCode=2;
  if(apply){
    if(finals!==1||semanticCommands!==1)process.exitCode=2;
    if(!closeoutEvidence)process.exitCode=2;
    if(!evidenceValidation||!evidenceValidation.valid)process.exitCode=2;
  }
}

if(require.main===module){
  main().catch(e=>{console.error(e);process.exit(1)});
}

module.exports={
  initialRuntimeFromPhysical,
  assertLiveProbePreconditions,
  closeout,
  main
};
