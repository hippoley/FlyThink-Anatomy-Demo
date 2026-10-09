"use strict";

const assert=require("assert");
const {
  verifyCloseoutEvidence
}=require("../scripts/execution_receipt.cjs");

const W={area:"主卧",entity:"窗",instance:"default"};
const OTHER={area:"客厅",entity:"窗",instance:"default"};

function closeReceipt(target=W,overrides={}){
  return {
    id:"windowpilot:closeout",
    status:"applied",
    patch:{op:"PATCH_SLOT",target,slot:"opening",value:0},
    ack:{ok:true,command_id:"ack-close"},
    before_tick:11,
    hardware_identity_before:"hw-1",
    hardware_identity_after:"hw-1",
    observation:{
      target,
      exists:true,
      slots:{opening:0},
      evidence:{
        source:"windowpilot:/api/state",
        position_pct:0,
        measured:true,
        tick:12,
        ack_at_ms:2000,
        received_at_ms:2001
      }
    },
    ...overrides
  };
}

function evidence(receipt=closeReceipt()){
  return {
    attempted:true,
    already_closed:false,
    before_position_pct:5,
    after_position_pct:0,
    tolerance_pct:1,
    receipt
  };
}

const originalPhysical=[{
  status:"applied",
  hardware_identity:{before:"hw-1",after:"hw-1"}
}];

assert.equal(
  verifyCloseoutEvidence(evidence(),originalPhysical,[W]),
  true
);

{
  const x=evidence();
  x.after_position_pct=2;
  assert.equal(verifyCloseoutEvidence(x,originalPhysical,[W]),false);
}

assert.equal(
  verifyCloseoutEvidence(evidence(closeReceipt(OTHER)),originalPhysical,[W]),
  false
);

{
  const receipt=closeReceipt(W,{ack:{ok:false}});
  assert.equal(verifyCloseoutEvidence(evidence(receipt),originalPhysical,[W]),false);
}

{
  const receipt=closeReceipt();
  receipt.observation.evidence.tick=11;
  assert.equal(verifyCloseoutEvidence(evidence(receipt),originalPhysical,[W]),false);
}

{
  const receipt=closeReceipt(W,{hardware_identity_before:"hw-2",hardware_identity_after:"hw-2"});
  assert.equal(verifyCloseoutEvidence(evidence(receipt),originalPhysical,[W]),false);
}

assert.equal(
  verifyCloseoutEvidence({
    attempted:false,
    already_closed:true,
    before_position_pct:0,
    after_position_pct:0,
    tolerance_pct:1,
    receipt:null
  },originalPhysical,[W]),
  true
);

console.log(JSON.stringify({
  ok:true,
  contract:"safe closeout requires same target, measured fresh ACK/readback, stable hardware identity, and observed closed position"
}));
