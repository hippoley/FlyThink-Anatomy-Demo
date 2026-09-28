"use strict";
const assert=require("assert");
const {captureTau0}=require("../scripts/capture_physical_tau0.cjs");
const {WindowPilotHttpDriver}=require("../scripts/windowpilot_http_driver.cjs");

const target={area:"客厅",entity:"窗",instance:"default"};
function readiness(){
  return {
    physical_write_ready:true,
    capture_preconditions:true,
    fresh_sensors:{rain:true,co2_ppm:true},
    measured_sensors:{rain:true,co2_ppm:true},
    registry_bound_sensors:{rain:true,co2_ppm:true},
    site_bound_sensors:{rain:true,co2_ppm:true},
    hardware_identity:{identity_sha256:"hw-live-1"},
    write_blockers:[]
  };
}

(async()=>{
  let pct=0;
  let phase="idle";
  let phaseReads=0;
  const calls=[];

  const driver=new WindowPilotHttpDriver({
    baseUrl:"http://windowpilot.test",
    target,
    expectedHardwareIdentity:"hw-live-1",
    tolerancePct:1,
    pollIntervalMs:0,
    maxPolls:4,
    timeoutMs:1000,
    requestJson:async(method,path,payload)=>{
      calls.push({method,path,payload});
      if(path==="/api/physical-readiness")return readiness();
      if(path==="/api/window/open"){
        assert.equal(payload.target_pct,20);
        phase="opening";phaseReads=0;
        return {ok:true,action:"open",target_pct:20};
      }
      if(path==="/api/window/close"){
        phase="closing";phaseReads=0;
        return {ok:true,action:"close"};
      }
      if(path==="/api/window/stop")return {ok:true,action:"stop"};
      if(path==="/api/state"){
        if(phase==="opening"){
          pct=phaseReads++===0?9:20;
          if(pct===20)phase="idle";
        }else if(phase==="closing"){
          pct=phaseReads++===0?7:0;
          if(pct===0)phase="idle";
        }
        return {
          tick:calls.length,
          thing_model:{
            window_open_pct:pct,
            rain_detected:false,
            wind_speed_ms:0
          }
        };
      }
      throw new Error("unexpected:"+path);
    }
  });

  const out=await captureTau0({
    driver,
    target,
    apply:true,
    expectedHardwareIdentity:"hw-live-1",
    openPct:20,
    tolerancePct:1,
    now:()=>1234567890
  });

  assert.equal(out.success,true);
  assert.equal(out.cleanup_required,false);
  assert.equal(out.invariants.open_observed,true);
  assert.equal(out.invariants.final_closed,true);
  assert.deepEqual(
    calls.filter(x=>x.method==="POST").map(x=>x.path),
    ["/api/window/open","/api/window/close"]
  );
  assert.equal(out.steps.find(x=>x.name==="open").observed_position_pct,20);
  assert.equal(out.steps.find(x=>x.name==="close").observed_position_pct,0);

  console.log(JSON.stringify({
    ok:true,
    contract:"WindowPilot HTTP driver + tau0 orchestrator measured open 20 -> close 0"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
