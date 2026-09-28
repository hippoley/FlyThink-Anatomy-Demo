"use strict";

const {run}=require("./stateful_checkpoint_trajectory.cjs");
const {WindowPilotHttpDriver}=require("./windowpilot_http_driver.cjs");

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}
function flag(name){return process.argv.includes(name)}
function parseTarget(raw){
  if(!raw)throw new Error("--target-json is required");
  const t=JSON.parse(raw);
  if(!t.area||!t.entity)throw new Error("target requires area/entity");
  return {area:t.area,entity:t.entity,instance:t.instance||"default"};
}

(async()=>{
  const url=arg("--url");
  const text=arg("--text");
  const target=parseTarget(arg("--target-json"));
  if(!url)throw new Error("--url is required");
  if(!text)throw new Error("--text is required");

  const inspect=new WindowPilotHttpDriver({
    baseUrl:url,
    target,
    expectedHardwareIdentity:arg("--expected-hardware-identity")||null
  });
  const readiness=await inspect.readiness();
  const physicalState=await inspect.state();
  const pct=Number(physicalState?.thing_model?.window_open_pct);
  if(!Number.isFinite(pct))throw new Error("WindowPilot state has no valid window_open_pct");

  const key=[target.area,target.entity,target.instance].join("::");
  const trajectory={
    initial_runtime:{devices:{
      [key]:{
        key,
        area:target.area,
        entity:target.entity,
        instance:target.instance,
        status:"mounted",
        model_id:"CWDS-CA01",
        slots:{opening:pct}
      }
    }},
    turns:[{
      text,
      context_hint:{focused_target:target}
    }]
  };

  const apply=flag("--apply");
  const result=await run(trajectory,{
    graph:arg("--graph"),
    judgement:arg("--judgement"),
    semantic:arg("--semantic"),
    physical:apply?"windowpilot":null,
    windowpilot_url:url,
    physical_target:target,
    expected_hardware_identity:arg("--expected-hardware-identity")||null,
    position_tolerance_pct:Number(arg("--tolerance")||1),
    physical_timeout_ms:Number(arg("--timeout-ms")||5000)
  });

  const turn=result.turns[0]||{};
  console.log(JSON.stringify({
    mode:apply?"APPLY":"DRY_RUN",
    readiness:{
      physical_write_ready:readiness.physical_write_ready,
      write_blockers:readiness.write_blockers||[],
      hardware_identity:readiness.hardware_identity||null
    },
    before:{position_pct:pct},
    semantic:{
      decision:turn.predicted,
      outcome:turn.outcome,
      patches:turn.applied_patches||[]
    },
    physical_receipts:turn.physical_receipts||[],
    after:result.runtime.devices[key]?.slots||null
  },null,2));
})().catch(e=>{console.error(e);process.exit(1)});
