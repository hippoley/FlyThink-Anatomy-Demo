"use strict";
const assert=require("assert");
const {WindowPilotHttpDriver}=require("../scripts/windowpilot_http_driver.cjs");
const {executePhysicalTurn}=require("../scripts/physical_runtime.cjs");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");

const target={area:"客厅",entity:"窗",instance:"default"};
const key="客厅::窗::default";
const initial=normalizeRuntime({devices:{
  [key]:{key,area:"客厅",entity:"窗",instance:"default",model_id:"CWDS-CA01",slots:{opening:0}}
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
function stateAt(tick,pct,extra={}){
  return {tick,thing_model:{window_open_pct:pct,rain_detected:false,wind_speed_ms:0,...extra}};
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
    const out=await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target,slot:"opening",value:30}],driver);
    assert.equal(out.receipts[0].status,"applied");
    assert.equal(out.runtime.devices[key].slots.opening,30);
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
    const out=await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target,slot:"opening",value:40}],driver);
    assert.equal(out.receipts[0].status,"blocked");
    assert.equal(out.receipts[0].reason,"physical_write_not_ready");
    assert.equal(out.runtime.devices[key].slots.opening,0);
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
    const out=await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target,slot:"opening",value:25}],driver);
    assert.equal(out.receipts[0].status,"blocked");
    assert.equal(out.receipts[0].reason,"rain_detected");
    assert.equal(out.runtime.devices[key].slots.opening,0);
    assert.equal(calls.filter(x=>x.method==="POST").length,0);
  }

  // 4. Timeout: polling is bounded, motion is STOPped, and final observed position wins.
  {
    let stateReads=0; const calls=[];
    const driver=new WindowPilotHttpDriver({
      baseUrl:"http://windowpilot.test",target,pollIntervalMs:0,maxPolls:2,timeoutMs:1000,
      requestJson:async(method,path,payload)=>{
        calls.push({method,path,payload});
        if(path==="/api/physical-readiness")return readiness();
        if(path==="/api/window/open")return {ok:true};
        if(path==="/api/window/stop")return {ok:true,action:"stop"};
        if(path==="/api/state"){
          const seq=[state(0),state(8),state(12),state(12)];
          return seq[Math.min(stateReads++,seq.length-1)];
        }
        throw new Error("unexpected:"+path);
      }
    });
    const out=await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target,slot:"opening",value:40}],driver);
    assert.equal(out.receipts[0].status,"timeout");
    assert.equal(out.runtime.devices[key].slots.opening,12);
    assert.notEqual(out.runtime.devices[key].slots.opening,40);
    assert.equal(out.receipts[0].observation.evidence.position_pct,12);
    assert.equal(driver.commands[0].polls,2);
    assert.equal(driver.commands[0].safety_stop.attempted,true);
    assert.equal(driver.commands[0].safety_stop.ack.ok,true);
    assert.equal(calls.filter(x=>x.path==="/api/window/stop").length,1);
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
    const out=await executePhysicalTurn(initial,[{op:"PATCH_SLOT",target,slot:"opening",value:20}],driver);
    assert.equal(out.receipts[0].status,"blocked");
    assert.equal(out.receipts[0].reason,"hardware_identity_mismatch");
    assert.equal(calls.filter(x=>x.method==="POST").length,0);
  }


  // 6. Natural "open window" ADD_DEVICE uses backend-compatible default 50% and reconciles measured opening.
  {
    let stateReads=0;
    const driver=new WindowPilotHttpDriver({
      baseUrl:"http://windowpilot.test",target,pollIntervalMs:0,maxPolls:3,
      requestJson:async(method,path,payload)=>{
        if(path==="/api/physical-readiness")return readiness();
        if(path==="/api/window/open"){
          assert.equal(payload.target_pct,50);
          return {ok:true,action:"open",target_pct:50};
        }
        if(path==="/api/state"){
          const seq=[state(0),state(25),state(50)];
          return seq[Math.min(stateReads++,seq.length-1)];
        }
        throw new Error("unexpected:"+path);
      }
    });
    const out=await executePhysicalTurn(initial,[{op:"ADD_DEVICE",target,slots:{power:"ON"}}],driver);
    assert.equal(out.receipts[0].status,"applied");
    assert.equal(out.runtime.devices[key].slots.opening,50);
    assert.equal(out.runtime.devices[key].slots.power,"ON");
  }

  // 7. A live acceptance max-open bound is enforced before actuator POST.
  {
    const calls=[];
    const driver=new WindowPilotHttpDriver({
      baseUrl:"http://windowpilot.test",target,maxOpenPct:5,
      requestJson:async(method,path,payload)=>{
        calls.push({method,path,payload});
        if(path==="/api/physical-readiness")return readiness();
        if(path==="/api/state")return state(0);
        throw new Error("unexpected:"+path);
      }
    });
    const out=await executePhysicalTurn(
      initial,
      [{op:"PATCH_SLOT",target,slot:"opening",value:50}],
      driver
    );
    assert.equal(out.receipts[0].status,"blocked");
    assert.equal(out.receipts[0].reason,"target_above_max_open_pct");
    assert.equal(out.runtime.devices[key].slots.opening,0);
    assert.equal(calls.filter(x=>x.method==="POST").length,0);
  }

  // 8. Fresh-readback mode rejects a target-position replay with a stale tick.
  {
    let stateReads=0; const calls=[];
    const driver=new WindowPilotHttpDriver({
      baseUrl:"http://windowpilot.test",target,pollIntervalMs:0,maxPolls:2,
      timeoutMs:1000,requireFreshReadback:true,
      requestJson:async(method,path,payload)=>{
        calls.push({method,path,payload});
        if(path==="/api/physical-readiness")return readiness();
        if(path==="/api/window/open")return {ok:true};
        if(path==="/api/window/stop")return {ok:true};
        if(path==="/api/state"){
          const seq=[
            stateAt(10,0),
            stateAt(10,30),
            stateAt(10,30),
            stateAt(10,30)
          ];
          return seq[Math.min(stateReads++,seq.length-1)];
        }
        throw new Error("unexpected:"+path);
      }
    });
    const out=await executePhysicalTurn(
      initial,[{op:"PATCH_SLOT",target,slot:"opening",value:30}],driver
    );
    assert.equal(out.receipts[0].status,"timeout");
    assert.equal(out.receipts[0].before_tick,10);
    assert.equal(out.receipts[0].observation.evidence.tick,10);
    assert.equal(calls.filter(x=>x.path==="/api/window/stop").length,1);
  }

  // 9. Post-readback identity drift makes the actuation uncertain, never applied.
  {
    let stateReads=0,readinessReads=0;
    const driver=new WindowPilotHttpDriver({
      baseUrl:"http://windowpilot.test",target,pollIntervalMs:0,maxPolls:2,
      expectedHardwareIdentity:"hw-1",
      requireFreshReadback:true,
      verifyHardwareIdentityAfterReadback:true,
      requestJson:async(method,path,payload)=>{
        if(path==="/api/physical-readiness"){
          readinessReads++;
          return readiness({
            hardware_identity:{
              identity_sha256:readinessReads===1?"hw-1":"hw-swapped"
            }
          });
        }
        if(path==="/api/window/open")return {ok:true};
        if(path==="/api/state"){
          const seq=[stateAt(20,0),stateAt(21,20)];
          return seq[Math.min(stateReads++,seq.length-1)];
        }
        throw new Error("unexpected:"+path);
      }
    });
    const out=await executePhysicalTurn(
      initial,[{op:"PATCH_SLOT",target,slot:"opening",value:20}],driver
    );
    assert.equal(out.receipts[0].status,"uncertain");
    assert.equal(out.receipts[0].reason,"hardware_identity_changed_after_actuation");
    assert.equal(out.receipts[0].hardware_identity_before,"hw-1");
    assert.equal(out.receipts[0].hardware_identity_after,"hw-swapped");
    assert.equal(out.receipts[0].observation.evidence.tick,21);
  }

  console.log(JSON.stringify({ok:true,cases:9,contract:"WindowPilot ACK != Reality; applied requires bounded fresh readback, stable hardware identity, and STOP on uncertainty"}));
})().catch(e=>{console.error(e);process.exit(1)});
