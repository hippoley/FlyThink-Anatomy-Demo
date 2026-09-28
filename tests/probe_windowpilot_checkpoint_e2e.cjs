"use strict";
const assert=require("assert");
const {assertApplyPreconditions}=require("../scripts/probe_windowpilot_checkpoint_e2e.cjs");

function readiness(overrides={}){
  return {
    physical_write_ready:true,
    write_blockers:[],
    hardware_identity:{identity_sha256:"hw-123"},
    ...overrides
  };
}

assert.doesNotThrow(()=>assertApplyPreconditions({
  apply:false,
  expectedHardwareIdentity:null,
  readiness:readiness({physical_write_ready:false})
}));

assert.throws(
  ()=>assertApplyPreconditions({apply:true,expectedHardwareIdentity:null,readiness:readiness()}),
  /--apply requires --expected-hardware-identity/
);

assert.throws(
  ()=>assertApplyPreconditions({
    apply:true,
    expectedHardwareIdentity:"hw-123",
    readiness:readiness({physical_write_ready:false,write_blockers:["commissioning"]})
  }),
  /physical_write_not_ready:commissioning/
);

assert.throws(
  ()=>assertApplyPreconditions({
    apply:true,
    expectedHardwareIdentity:"hw-123",
    readiness:readiness({hardware_identity:null})
  }),
  /physical_hardware_identity_unavailable/
);

assert.throws(
  ()=>assertApplyPreconditions({
    apply:true,
    expectedHardwareIdentity:"wrong",
    readiness:readiness()
  }),
  /hardware_identity_mismatch/
);

assert.doesNotThrow(()=>assertApplyPreconditions({
  apply:true,
  expectedHardwareIdentity:"hw-123",
  readiness:readiness()
}));

console.log(JSON.stringify({ok:true,contract:"live apply requires ready matching hardware identity"}));
