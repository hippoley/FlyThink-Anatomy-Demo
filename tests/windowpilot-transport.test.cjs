"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {WindowPilotTransport}=require("../scripts/windowpilot_transport.cjs");
const {
  loadBindings,
  executeSemanticTurnAsync
}=require("../scripts/physical_runtime_protocol.cjs");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");

const ID="a".repeat(64);
const WINDOW={area:"客厅",entity:"窗户",instance:"default"};

function jsonResponse(payload,status=200){
  return {
    ok:status>=200 && status<300,
    status,
    async json(){return JSON.parse(JSON.stringify(payload));}
  };
}

function readiness(overrides={}){
  return {
    commissioning_ready:true,
    physical_write_ready:true,
    write_contract_ready:true,
    motion_semantics_ready:true,
    write_blockers:[],
    backend:{
      backend:"cwds-ca01-thingmodel",
      transport:"thingmodel-http",
      simulated:false,
      percent_control:true,
      measured_position:true,
      stop_supported:true,
      position_source:"motor_1.motorCurrentPosition"
    },
    latest_position_feedback:{
      position_pct:100,
      timestamp:100,
      measured:true,
      source:"CWDS-CA01.motor_1.motorCurrentPosition",
      quality:"measured-encoder"
    },
    hardware_identity:{
      identity_sha256:ID,
      product_model:"CWDS-CA01",
      device_id:"window-real-01"
    },
    ...overrides
  };
}

function transport(options={}){
  return new WindowPilotTransport({
    baseUrl:"http://windowpilot.test",
    expectedIdentitySha:ID,
    allowPhysicalWrite:true,
    nowFn:()=>100.5,
    sleepFn:async()=>{},
    pollAttempts:3,
    ...options
  });
}

function windowRuntime(){
  return normalizeRuntime({
    devices:{
      "客厅::窗户::default":{
        key:"客厅::窗户::default",
        area:"客厅",
        entity:"窗户",
        instance:"default",
        model_id:"CWDS-CA01",
        slots:{opening:100},
        physical_binding:{
          entity_id:"physical_dev_home_001.window.combo01",
          semantic_role:"exterior_window"
        }
      }
    }
  });
}

test("physical write is disabled by default before any network call",async()=>{
  const calls=[];
  const t=new WindowPilotTransport({
    baseUrl:"http://windowpilot.test",
    expectedIdentitySha:ID,
    allowPhysicalWrite:false,
    fetchImpl:async(...args)=>{calls.push(args);return jsonResponse({});}
  });
  await assert.rejects(
    ()=>t.write({
      product_model:"CWDS-CA01",
      module:"motor_1",
      code:"motorTargetPosition",
      value:30
    }),
    /physical_write_not_explicitly_enabled/
  );
  assert.equal(calls.length,0);
});

test("readiness false blocks before command POST",async()=>{
  const calls=[];
  const t=transport({
    fetchImpl:async(url,init)=>{
      calls.push({url,init});
      return jsonResponse(readiness({
        physical_write_ready:false,
        write_contract_ready:false,
        write_blockers:["set_path is missing"]
      }));
    }
  });
  await assert.rejects(
    ()=>t.write({
      product_model:"CWDS-CA01",
      module:"motor_1",
      code:"motorTargetPosition",
      value:30
    }),
    /windowpilot_physical_write_not_ready/
  );
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/api\/physical-readiness$/);
});

test("hardware identity mismatch blocks before command POST",async()=>{
  const calls=[];
  const t=transport({
    expectedIdentitySha:"b".repeat(64),
    fetchImpl:async(url,init)=>{
      calls.push({url,init});
      return jsonResponse(readiness());
    }
  });
  await assert.rejects(
    ()=>t.write({
      product_model:"CWDS-CA01",
      module:"motor_1",
      code:"motorTargetPosition",
      value:30
    }),
    /windowpilot_hardware_identity_mismatch/
  );
  assert.equal(calls.length,1);
});

test("target position maps to WindowPilot command and polls measured feedback",async()=>{
  const calls=[];
  let capRead=0;
  const t=transport({
    fetchImpl:async(url,init)=>{
      calls.push({url,init});
      if(url.endsWith("/api/physical-readiness")) return jsonResponse(readiness());
      if(url.endsWith("/api/window/open")){
        assert.equal(init.method,"POST");
        assert.deepEqual(JSON.parse(init.body),{target_pct:30});
        return jsonResponse({ok:true,action:"open",target_pct:30});
      }
      if(url.endsWith("/api/capabilities")){
        capRead++;
        return jsonResponse({
          execution:{simulated:false,measured_position:true},
          position_feedback:{
            position_pct:capRead===1?55:30,
            timestamp:100.25,
            measured:true,
            source:"CWDS-CA01.motor_1.motorCurrentPosition",
            quality:"measured-encoder"
          }
        });
      }
      throw new Error("unexpected_url:"+url);
    }
  });

  const ack=await t.write({
    product_model:"CWDS-CA01",
    module:"motor_1",
    code:"motorTargetPosition",
    value:30
  });
  const observed=await t.read(
    {code:"motorCurrentPosition"},
    {expectation:{slot:"opening",value:30}}
  );

  assert.equal(ack.accepted,true);
  assert.equal(observed,30);
  assert.equal(capRead,2);
  assert.ok(calls.some(x=>x.url.endsWith("/api/window/open")));
});

test("valid measured feedback that misses target is returned for runtime mismatch",async()=>{
  const t=transport({
    pollAttempts:2,
    fetchImpl:async(url)=>{
      if(url.endsWith("/api/capabilities")){
        return jsonResponse({
          position_feedback:{
            position_pct:40,
            timestamp:100.25,
            measured:true,
            source:"CWDS-CA01.motor_1.motorCurrentPosition",
            quality:"measured-encoder"
          }
        });
      }
      throw new Error("unexpected_url:"+url);
    }
  });
  const observed=await t.read(
    {code:"motorCurrentPosition"},
    {expectation:{slot:"opening",value:30}}
  );
  assert.equal(observed,40);
});

test("stale measured feedback is rejected",async()=>{
  const t=transport({
    maxFeedbackAgeS:10,
    fetchImpl:async()=>jsonResponse(readiness({
      latest_position_feedback:{
        position_pct:100,
        timestamp:50,
        measured:true,
        source:"CWDS-CA01.motor_1.motorCurrentPosition",
        quality:"measured-encoder"
      }
    }))
  });
  await assert.rejects(
    ()=>t.preflight(),
    /windowpilot_feedback_stale/
  );
});

test("write accepted but feedback failure becomes OBSERVATION_FAILED without inventing state",async()=>{
  const bindings=loadBindings();
  const fake={
    async write(){return {accepted:true};},
    async read(){throw new Error("feedback_timeout");}
  };
  const out=await executeSemanticTurnAsync({
    runtime:windowRuntime(),
    proposal:{
      decision:"EXECUTE",
      patches:[{op:"PATCH_SLOT",target:WINDOW,slot:"opening",value:30}]
    },
    commit_state:"SAFE_TO_COMMIT",
    transport:fake,
    bindings
  });
  assert.equal(out.outcome,"EXECUTE");
  assert.equal(out.physical_status,"OBSERVATION_FAILED");
  assert.equal(out.runtime.devices["客厅::窗户::default"].slots.opening,100);
  assert.equal(
    out.runtime.devices["客厅::窗户::default"].physical.desired.semantic.value,
    30
  );
  assert.equal(
    out.runtime.devices["客厅::窗户::default"].physical.status,
    "OBSERVATION_FAILED"
  );
  assert.match(
    out.runtime.devices["客厅::窗户::default"].physical.observation_error,
    /feedback_timeout/
  );
});
