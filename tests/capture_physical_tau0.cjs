"use strict";
const assert=require("assert");
const {
  captureTau0,
  sanitizeEvidence,
  bundleHash
}=require("../scripts/capture_physical_tau0.cjs");

const target={area:"客厅",entity:"窗",instance:"default"};

function ready(overrides={}){
  return {
    physical_write_ready:true,
    capture_preconditions:true,
    fresh_sensors:{rain:true,co2_ppm:true},
    measured_sensors:{rain:true,co2_ppm:true},
    registry_bound_sensors:{rain:true,co2_ppm:true},
    site_bound_sensors:{rain:true,co2_ppm:true},
    hardware_identity:{identity_sha256:"hw-123"},
    write_blockers:[],
    ...overrides
  };
}
function state(pct,extra={}){
  return {tick:7,thing_model:{window_open_pct:pct,rain_detected:false,wind_speed_ms:0,...extra}};
}
function receipt(status,pct,extra={}){
  return {
    id:"test:"+status+":"+pct,
    status,
    observation:{
      target,
      exists:true,
      slots:{opening:pct},
      evidence:{source:"windowpilot:/api/state",position_pct:pct,measured:true}
    },
    ...extra
  };
}
class FakeDriver{
  constructor({readiness=ready(),state0=state(0),receipts=[]}={}){
    this.readinessValue=readiness;
    this.stateValue=state0;
    this.receipts=[...receipts];
    this.calls=[];
  }
  async readiness(){this.calls.push({kind:"readiness"});return this.readinessValue}
  async state(){this.calls.push({kind:"state"});return this.stateValue}
  async execute(p){
    this.calls.push({kind:"execute",patch:JSON.parse(JSON.stringify(p))});
    if(!this.receipts.length)throw new Error("missing_fake_receipt");
    return this.receipts.shift();
  }
}

(async()=>{
  // 1. DRY_RUN proves readiness without moving hardware.
  {
    const d=new FakeDriver();
    const out=await captureTau0({
      driver:d,target,openPct:20,tolerancePct:1,now:()=>0
    });
    assert.equal(out.mode,"DRY_RUN");
    assert.equal(out.ready_for_apply,true);
    assert.equal(out.success,true);
    assert.equal(out.invariants.baseline_closed,true);
    assert.equal(out.actual_hardware_identity,"hw-123");
    assert.equal(d.calls.filter(x=>x.kind==="execute").length,0);
    assert.equal(out.bundle_sha256,bundleHash(out));
  }

  // 2. APPLY requires measured open AND measured close.
  {
    const d=new FakeDriver({receipts:[receipt("applied",20),receipt("applied",0)]});
    const out=await captureTau0({
      driver:d,target,apply:true,expectedHardwareIdentity:"hw-123",
      openPct:20,tolerancePct:1,now:()=>1000
    });
    assert.equal(out.success,true);
    assert.equal(out.cleanup_required,false);
    assert.equal(out.invariants.open_observed,true);
    assert.equal(out.invariants.final_closed,true);
    const writes=d.calls.filter(x=>x.kind==="execute").map(x=>x.patch.value);
    assert.deepEqual(writes,[20,0]);
  }

  // 3. Identity mismatch fails before any actuator command.
  {
    const d=new FakeDriver();
    const out=await captureTau0({
      driver:d,target,apply:true,expectedHardwareIdentity:"wrong",
      openPct:20,tolerancePct:1
    });
    assert.equal(out.success,false);
    assert.equal(out.error.code,"tau0_preflight_failed");
    assert.ok(out.error.details.includes("hardware_identity_mismatch"));
    assert.equal(d.calls.filter(x=>x.kind==="execute").length,0);
  }

  // 4. Capture preconditions are stricter than write readiness.
  {
    const d=new FakeDriver({readiness:ready({capture_preconditions:false})});
    const out=await captureTau0({
      driver:d,target,apply:true,expectedHardwareIdentity:"hw-123"
    });
    assert.equal(out.success,false);
    assert.ok(out.error.details.includes("capture_preconditions_not_ready"));
    assert.equal(d.calls.filter(x=>x.kind==="execute").length,0);
  }

  // 5. We never silently normalize an already-open baseline.
  {
    const d=new FakeDriver({state0:state(8)});
    const out=await captureTau0({
      driver:d,target,apply:true,expectedHardwareIdentity:"hw-123",tolerancePct:1
    });
    assert.equal(out.success,false);
    assert.ok(out.error.details.includes("baseline_not_closed"));
    assert.equal(d.calls.filter(x=>x.kind==="execute").length,0);
  }

  // 6. Failed/timeout opening still forces a close attempt.
  {
    const d=new FakeDriver({receipts:[
      receipt("timeout",11,{reason:"position_not_observed_within_tolerance"}),
      receipt("applied",0)
    ]});
    const out=await captureTau0({
      driver:d,target,apply:true,expectedHardwareIdentity:"hw-123",openPct:20
    });
    assert.equal(out.success,false);
    assert.equal(out.error.code,"tau0_open_not_observed");
    assert.equal(out.invariants.final_closed,true);
    assert.equal(out.cleanup_required,false);
    assert.deepEqual(d.calls.filter(x=>x.kind==="execute").map(x=>x.patch.value),[20,0]);
  }

  // 7. If cleanup cannot be measured closed, evidence screams for manual recovery.
  {
    const d=new FakeDriver({receipts:[
      receipt("applied",20),
      receipt("blocked",20,{reason:"physical_write_not_ready"})
    ]});
    const out=await captureTau0({
      driver:d,target,apply:true,expectedHardwareIdentity:"hw-123",openPct:20
    });
    assert.equal(out.success,false);
    assert.equal(out.cleanup_required,true);
    assert.equal(out.invariants.final_closed,false);
    assert.equal(out.error.code,"tau0_cleanup_not_confirmed");
  }

  // 8. Evidence bundles must not persist accidental credentials.
  {
    const clean=sanitizeEvidence({
      hardware_identity:{identity_sha256:"hw-123"},
      auth_token:"abc",
      nested:{api_key:"xyz",password:"pw",safe:"ok"}
    });
    assert.equal(clean.auth_token,"[REDACTED]");
    assert.equal(clean.nested.api_key,"[REDACTED]");
    assert.equal(clean.nested.password,"[REDACTED]");
    assert.equal(clean.nested.safe,"ok");
    assert.equal(clean.hardware_identity.identity_sha256,"hw-123");
  }

  console.log(JSON.stringify({
    ok:true,
    cases:8,
    contract:"tau0 requires measured ready identity-bound open->close with fail-closed cleanup evidence"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
