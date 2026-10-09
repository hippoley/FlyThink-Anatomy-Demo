"use strict";

const assert=require("assert");
const {
  initialRuntimeFromPhysical,
  assertLiveProbePreconditions,
  closeout
}=require("../scripts/run_acoustic_windowpilot_e2e.cjs");

const target={area:"主卧",entity:"窗",instance:"default"};

function readiness(overrides={}){
  return {
    physical_write_ready:true,
    write_blockers:[],
    hardware_identity:{identity_sha256:"hw-live-1"},
    ...overrides
  };
}

{
  assert.doesNotThrow(()=>assertLiveProbePreconditions({
    apply:false,
    target,
    probeOpenPct:5,
    tolerancePct:1,
    initialPct:37,
    expectedHardwareIdentity:null,
    readiness:readiness({physical_write_ready:false})
  }));
}

assert.throws(
  ()=>assertLiveProbePreconditions({
    apply:true,target,probeOpenPct:6,tolerancePct:1,initialPct:0,
    expectedHardwareIdentity:"hw-live-1",readiness:readiness()
  }),
  /gt0_lte5/
);

assert.throws(
  ()=>assertLiveProbePreconditions({
    apply:true,target,probeOpenPct:5,tolerancePct:1,initialPct:4,
    expectedHardwareIdentity:"hw-live-1",readiness:readiness()
  }),
  /requires_initially_closed/
);

assert.throws(
  ()=>assertLiveProbePreconditions({
    apply:true,target,probeOpenPct:5,tolerancePct:1,initialPct:0,
    expectedHardwareIdentity:null,readiness:readiness()
  }),
  /--apply requires --expected-hardware-identity/
);

assert.throws(
  ()=>assertLiveProbePreconditions({
    apply:true,target,probeOpenPct:5,tolerancePct:1,initialPct:0,
    expectedHardwareIdentity:"wrong",readiness:readiness()
  }),
  /hardware_identity_mismatch/
);

assert.doesNotThrow(()=>assertLiveProbePreconditions({
  apply:true,target,probeOpenPct:5,tolerancePct:1,initialPct:0,
  expectedHardwareIdentity:"hw-live-1",readiness:readiness()
}));

(async()=>{
  {
    const runtime=initialRuntimeFromPhysical(target,0);
    let executeCalls=0;
    const driver={
      state:async()=>({thing_model:{window_open_pct:0}}),
      execute:async()=>{executeCalls++;throw new Error("should not execute")}
    };
    const out=await closeout(driver,runtime,target,1);
    assert.equal(out.attempted,false);
    assert.equal(out.already_closed,true);
    assert.equal(executeCalls,0);
    assert.equal(out.after_position_pct,0);
    assert.equal(out.tolerance_pct,1);
  }

  {
    const runtime=initialRuntimeFromPhysical(target,5);
    let executeCalls=0;
    const driver={
      state:async()=>({thing_model:{window_open_pct:5}}),
      execute:async patch=>{
        executeCalls++;
        assert.equal(patch.op,"PATCH_SLOT");
        assert.equal(patch.slot,"opening");
        assert.equal(patch.value,0);
        return {
          id:"closeout:1",
          status:"applied",
          observation:{
            target,
            exists:true,
            slots:{opening:0,power:"OFF"},
            evidence:{position_pct:0,measured:true}
          }
        };
      }
    };
    const out=await closeout(driver,runtime,target,1);
    assert.equal(out.attempted,true);
    assert.equal(executeCalls,1);
    assert.equal(out.after_position_pct,0);
    assert.equal(out.tolerance_pct,1);
    const key="主卧::窗::default";
    assert.equal(out.runtime.devices[key].slots.opening,0);
    assert.equal(out.runtime.devices[key].slots.power,"OFF");
  }

  console.log(JSON.stringify({
    ok:true,
    contract:"acoustic live apply is bounded, identity-pinned, initially closed, and closeout-verified"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
