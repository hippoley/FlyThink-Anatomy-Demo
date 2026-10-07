"use strict";

const assert=require("assert");
const {
  buildReceipt,
  finalizeReceipt,
  validateReceipt
}=require("../scripts/acoustic_windowpilot_evidence.cjs");

const target={area:"主卧",entity:"窗",instance:"default"};
const event={
  type:"asr_hypothesis",kind:"final",text:"打开主卧窗",
  segment_id:1,revision:2,source:"sherpa-onnx"
};
const feedback={
  target,
  exists:true,
  slots:{opening:5,power:"ON"},
  evidence:{source:"windowpilot:/api/state",position_pct:5,measured:true}
};
const command={
  id:"windowpilot:1",
  status:"applied",
  requested_position_pct:5,
  observation:feedback
};
const trace=[{
  asr:{kind:"final",text:"打开主卧窗",is_final:true},
  committed:true,
  target_resolution:{targets:[target]},
  patch_proposal:[{op:"PATCH_SLOT",target,slot:"opening",value:5}],
  thing_model:[{binding:{target,model_id:"CWDS-CA01",slot:"opening",op:"PATCH_SLOT"}}],
  feedback:[feedback],
  reconcile:{changed_device_paths:["主卧::窗::default::slots::opening"]},
  physical_command_count_before:0,
  physical_command_count_after:1
}];
const runtime={devices:{
  "主卧::窗::default":{
    key:"主卧::窗::default",area:"主卧",entity:"窗",instance:"default",
    model_id:"CWDS-CA01",status:"mounted",slots:{opening:0,power:"OFF"}
  }
}};
const fixture={
  schema:"flythink.acoustic_fixture.v1",
  source_kind:"human_recording",
  expected_text:"打开主卧窗",
  wav_sha256:"a".repeat(64),
  provenance_note:"reviewed microphone recording",
  require_human_acceptance:true
};

const valid=buildReceipt({
  mode:"APPLY",
  target,
  probeOpenPct:5,
  tolerancePct:1,
  expectedHardwareIdentity:"hw-1",
  readiness:{
    physical_write_ready:true,
    write_blockers:[],
    hardware_identity:{identity_sha256:"hw-1"}
  },
  beforePositionPct:0,
  acceptedEvents:[event],
  trace,
  driverCommands:[command,{
    id:"windowpilot:2",
    status:"applied",
    requested_position_pct:0,
    observation:{
      target,exists:true,slots:{opening:0,power:"OFF"},
      evidence:{source:"windowpilot:/api/state",position_pct:0,measured:true}
    }
  }],
  closeout:{
    attempted:true,already_closed:false,
    before_position_pct:5,after_position_pct:0,
    receipt:{status:"applied"}
  },
  runtime,
  acousticFixture:fixture
});
{
  const report=validateReceipt(valid,{requireHumanFixture:true});
  assert.equal(report.valid,true,JSON.stringify(report.reasons));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.asr.final_texts=["打开客厅灯"];
  const report=validateReceipt(bad,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("evidence SHA256 mismatch"));
  assert.ok(report.reasons.includes("final ASR transcript does not match frozen fixture text"));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.observed_hardware_identity="other-hw";
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("hardware identity mismatch"));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.acoustic_fixture.source_kind="local_tts";
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("acoustic fixture is not a human recording"));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.physical.closeout.after_position_pct=4;
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("closeout did not restore closed position"));
}

console.log(JSON.stringify({
  ok:true,
  contract:"human acoustic + hardware identity + measured readback + closeout evidence is independently auditable"
}));
