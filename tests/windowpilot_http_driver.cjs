"use strict";
const assert=require("assert");
const {WindowPilotHttpDriver}=require("../scripts/windowpilot_http_driver.cjs");
const {executePhysicalTurn}=require("../scripts/physical_runtime.cjs");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");

const target={area:"客厅",entity:"窗",instance:"default"};
const key="客厅::窗::default";
const initial=normalizeRuntime({devices:{
  [key]:{key,area:"客厅",entity:"窗",instance:"default",model_id:"CWDS-CA01",slots:{position:0}}
}});

function readiness(overrides={}){
  return {
    physical_write_ready:true,
    fresh_sensors:{rain:true},
    measured_sensors:{rain:true},
    registry_bound_sensors:{rain:true},
    site_bound_sensors:{rain:true},
    hardware_identity:{identity_sha256:"hw-1"},
    ...overrides
  };
}
function state(pct,extra={}){
  return {tick:1,thing_model:{window_open_pct:pct,rain_detected:false,wind_speed_ms:0,...extra}};
}

(async()=>{
  // 1. Happy path: ACK is not enough; readback must reach target.
  {
    const calls=[]; let stateReads=0;
    const driver=new WindowPilotHttpDriver({
      baseUrl:"http://windowpilot.test",target,pollIntervalMs:0,maxPolls:4,
      requestJson:async(method,path,payload)=>{
        calls.push({method,path,payload});
        if(path==="/api/physical-readiness")return readiness();
        if(path==="/api/window/open")return {ok:true,action:"open",target_pct:30};
        if(path==="/api/state"){
          const seq=[state(0),state(12),state(30)];
          return seq[Math.min(stateReads++,seq.length-1)];
        }
        throw new Error("unexpected:"+path);
      }
    });
    const out=await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target,slot:"position",value:30}],driver);
    assert.equal(out.receipts[0].status,"applied");
    assert.equal(out.runtime.devices[key].slots.position,30);
    assert.ok(calls.some(x=>x.path==="/api/window/open"));
  }

  // 2. Write gate blocked: no actuator POST and no requested-state leak.
  {
    const calls=[];
    const driver=new WindowPilotHttpDriver({
      baseUrl:"http://windowpilot.test",target,pollIntervalMs:0,maxPolls:2,
      requestJson:async(method,path,payload)=>{
        calls.push({method,path,payload});
        if(path==="/api/physical-readiness")return readiness({physical_write_ready:false});
        if(path==="/api/state")return state(0);
        throw new Error("unexpected:"+path);
      }
    });
    const out=await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target,slot:"position",value:40}],driver);
    assert.equal(out.receipts[0].status,"blocked");
    assert.equal(out.receipts[0].reason,"physical_write_not_ready");
    assert.equal(out.runtime.devices[key].slots.position,0);
    assert.equal(calls.filter(x=>x.method==="POST").length,0);
  }

  // 3. Opening fails closed when trustworthy rain evidence says it is raining.
  {
    const calls=[];
    const driver=new WindowPilotHttpDriver({
      baseUrl:"http://windowpilot.test",target,pollIntervalMs:0,maxPolls:2,
      requestJson:async(method,path,payload)=>{
        calls.push({method,path,payload});
        if(path==="/api/physical-readiness")return readiness();
        if(path==="/api/state")return state(0,{rain_detected:true});
        throw new Error("unexpected:"+path);
      }
    });
    const out=await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target,slot:"position",value:25}],driver);
    assert.equal(out.receipts[0].status,"blocked");
    assert.equal(out.receipts[0].reason,"rain_detected");
    assert.equal(out.runtime.devices[key].slots.position,0);
    assert.equal(calls.filter(x=>x.method==="POST").length,0);
  }

  // 4. Timeout: final observed position wins over requested target.
  {
    let stateReads=0;
    const driver=new WindowPilotHttpDriver({
      baseUrl:"http://windowpilot.test",target,pollIntervalMs:0,maxPolls:2,timeoutMs:1000,
      requestJson:async(method,path,payload)=>{
        if(path==="/api/physical-readiness")return readiness();
        if(path==="/api/window/open")return {ok:true};
        if(path==="/api/state"){
          const seq=[state(0),state(8),state(12)];
          return seq[Math.min(stateReads++,seq.length-1)];
        }
        throw new Error("unexpected:"+path);
      }
    });
    const out=await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target,slot:"position",value:40}],driver);
    assert.equal(out.receipts[0].status,"timeout");
    assert.equal(out.runtime.devices[key].slots.position,12);
    assert.notEqual(out.runtime.devices[key].slots.position,40);
  }

  // 5. Identity mismatch blocks the write before any motion.
  {
    const calls=[];
    const driver=new WindowPilotHttpDriver({
      baseUrl:"http://windowpilot.test",target,expectedHardwareIdentity:"expected-hw",
      requestJson:async(method,path,payload)=>{
        calls.push({method,path,payload});
        if(path==="/api/physical-readiness")return readiness();
        if(path==="/api/state")return state(0);
        throw new Error("unexpected:"+path);
      }
    });
    const out=await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target,slot:"position",value:20}],driver);
    assert.equal(out.receipts[0].status,"blocked");
    assert.equal(out.receipts[0].reason,"hardware_identity_mismatch");
    assert.equal(calls.filter(x=>x.method==="POST").length,0);
  }

  console.log(JSON.stringify({ok:true,cases:5,contract:"WindowPilot ACK != Reality; readback is authoritative"}));
})().catch(e=>{console.error(e);process.exit(1)});
