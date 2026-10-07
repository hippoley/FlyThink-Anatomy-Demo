"use strict";

const assert=require("assert");
const crypto=require("crypto");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawnSync}=require("child_process");
const {
  buildReceipt,
  finalizeReceipt,
  validateReceipt,
  sha256Object
}=require("../scripts/acoustic_windowpilot_evidence.cjs");
const {
  assertLiveSemanticProposal
}=require("../scripts/run_acoustic_windowpilot_e2e.cjs");

const target={area:"主卧",entity:"窗",instance:"default"};
const event={
  type:"asr_hypothesis",kind:"final",text:"打开主卧窗",
  segment_id:1,revision:2,source:"sherpa-onnx"
};
const feedback={
  target,
  exists:true,
  slots:{opening:5,power:"ON"},
  evidence:{
    source:"windowpilot:/api/state",
    position_pct:5,
    tick:11,
    ack_at_ms:1000,
    received_at_ms:1001,
    measured:true
  }
};
const semanticPatch={op:"PATCH_SLOT",target,slot:"opening",value:5};
const command={
  id:"windowpilot:1",
  patch:semanticPatch,
  status:"applied",
  requested_position_pct:5,
  before_tick:10,
  readiness_before:{physical_write_ready:true,hardware_identity:{identity_sha256:"hw-1"}},
  readiness_after:{physical_write_ready:true,hardware_identity:{identity_sha256:"hw-1"}},
  hardware_identity_before:"hw-1",
  hardware_identity_after:"hw-1",
  observation:feedback
};
const closeoutCommand={
  id:"windowpilot:2",
  status:"applied",
  requested_position_pct:0,
  before_tick:11,
  readiness_before:{physical_write_ready:true,hardware_identity:{identity_sha256:"hw-1"}},
  readiness_after:{physical_write_ready:true,hardware_identity:{identity_sha256:"hw-1"}},
  hardware_identity_before:"hw-1",
  hardware_identity_after:"hw-1",
  observation:{
    target,exists:true,slots:{opening:0,power:"OFF"},
    evidence:{
      source:"windowpilot:/api/state",
      position_pct:0,
      tick:12,
      ack_at_ms:1002,
      received_at_ms:1003,
      measured:true
    }
  }
};
const trace=[{
  asr:{kind:"final",text:"打开主卧窗",is_final:true},
  committed:true,
  target_resolution:{targets:[target]},
  patch_proposal:[semanticPatch],
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
assert.doesNotThrow(()=>assertLiveSemanticProposal({
  decision:"EXECUTE",
  patches:[{op:"PATCH_SLOT",target,slot:"opening",value:5}]
},true));
assert.throws(
  ()=>assertLiveSemanticProposal({
    decision:"EXECUTE",
    patches:[
      {op:"PATCH_SLOT",target,slot:"opening",value:5},
      {op:"PATCH_SLOT",target,slot:"opening",value:3}
    ]
  },true),
  /requires_exactly_one_semantic_patch/
);
assert.doesNotThrow(()=>assertLiveSemanticProposal({
  decision:"EXECUTE",
  patches:[
    {op:"PATCH_SLOT",target,slot:"opening",value:5},
    {op:"PATCH_SLOT",target,slot:"opening",value:3}
  ]
},false));

const fixture={
  schema:"flythink.acoustic_fixture.v1",
  source_kind:"human_recording",
  expected_text:"打开主卧窗",
  max_cer:0.25,
  wav_sha256:"a".repeat(64),
  manifest_sha256:"b".repeat(64),
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
  driverCommands:[command,closeoutCommand],
  closeout:{
    attempted:true,already_closed:false,
    before_position_pct:5,after_position_pct:0,
    receipt:closeoutCommand
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
  assert.ok(report.reasons.includes("ASR CER exceeds frozen fixture threshold"));
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

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.semantic.committed_finals[0].patches.push(
    {op:"PATCH_SLOT",target,slot:"opening",value:3}
  );
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("expected exactly one committed semantic patch"));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.physical.driver_commands.splice(1,0,{
    id:"windowpilot:extra",
    status:"applied",
    requested_position_pct:3,
    observation:{
      target,exists:true,slots:{opening:3,power:"ON"},
      evidence:{source:"windowpilot:/api/state",position_pct:3,measured:true}
    }
  });
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes(
    "expected exactly one semantic command plus one closeout command"
  ));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.probe_open_pct=1;
  bad.tolerance_pct=2;
  bad.semantic.committed_finals[0].feedback[0].evidence.position_pct=0;
  bad.physical.driver_commands[0].requested_position_pct=1;
  bad.physical.driver_commands[0].observation.evidence.position_pct=0;
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("probe target must exceed tolerance"));
  assert.ok(report.reasons.includes(
    "semantic command did not produce observable opening motion"
  ));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.physical.closeout.receipt.status="timeout";
  bad.physical.driver_commands[1].status="timeout";
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("closeout physical command not applied"));
  assert.ok(report.reasons.includes("closeout driver command not applied"));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.physical.driver_commands[0].observation.evidence.tick=10;
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("semantic readback tick is not causally newer"));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.physical.driver_commands[0].hardware_identity_after="hw-swapped";
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("semantic post-readback hardware identity mismatch"));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.physical.driver_commands[0].observation.evidence.received_at_ms=999;
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes(
    "semantic readback was not received after actuator ACK"
  ));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.physical.driver_commands[0].observation.evidence.source="cache:windowpilot";
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes(
    "semantic readback source is not WindowPilot state"
  ));
}

{
  const bad=JSON.parse(JSON.stringify(valid));
  bad.physical.closeout.receipt={...bad.physical.closeout.receipt,polls:999};
  delete bad.evidence_sha256;
  const resigned=finalizeReceipt(bad);
  const report=validateReceipt(resigned,{requireHumanFixture:true});
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("closeout receipt does not match driver command"));
}

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-evidence-"));
  const wavPath=path.join(root,"human.wav");
  const manifestPath=path.join(root,"human.json");
  const receiptPath=path.join(root,"receipt.json");
  fs.writeFileSync(wavPath,Buffer.from("reviewed-human-wav-bytes-v1"));

  const wavSha=crypto.createHash("sha256").update(fs.readFileSync(wavPath)).digest("hex");
  const manifest={
    schema:"flythink.acoustic_fixture.v1",
    source_kind:"human_recording",
    expected_text:"打开主卧窗",
    provenance_note:"reviewed microphone recording",
    acceptance:{max_cer:0.25},
    wav:{sha256:wavSha}
  };
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
  const manifestSha=crypto.createHash("sha256")
    .update(fs.readFileSync(manifestPath)).digest("hex");

  const fileReceipt=buildReceipt({
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
    driverCommands:[command,closeoutCommand],
    closeout:{
      attempted:true,already_closed:false,
      before_position_pct:5,after_position_pct:0,receipt:closeoutCommand
    },
    runtime,
    acousticFixture:{
      schema:"flythink.acoustic_fixture.v1",
      source_kind:"human_recording",
      expected_text:"打开主卧窗",
      max_cer:0.25,
      wav_sha256:wavSha,
      manifest_sha256:manifestSha,
      provenance_note:"reviewed microphone recording",
      require_human_acceptance:true
    }
  });
  fs.writeFileSync(receiptPath,JSON.stringify(fileReceipt,null,2)+"\n");

  const verifier=path.join(__dirname,"..","scripts","verify_acoustic_windowpilot_evidence.cjs");
  const pass=spawnSync(process.execPath,[
    verifier,
    "--receipt",receiptPath,
    "--wav",wavPath,
    "--fixture-manifest",manifestPath,
    "--require-human-fixture"
  ],{encoding:"utf8"});
  assert.equal(pass.status,0,pass.stdout+"\n"+pass.stderr);

  fs.writeFileSync(wavPath,Buffer.from("replaced-wav-bytes"));
  const fail=spawnSync(process.execPath,[
    verifier,
    "--receipt",receiptPath,
    "--wav",wavPath,
    "--fixture-manifest",manifestPath,
    "--require-human-fixture"
  ],{encoding:"utf8"});
  assert.equal(fail.status,2,fail.stdout+"\n"+fail.stderr);
  assert.match(fail.stdout,/WAV SHA256 mismatch/);
}

console.log(JSON.stringify({
  ok:true,
  contract:"human acoustic flagship evidence requires causal fresh readback, stable hardware identity, one observable semantic action, and one matching applied closeout"
}));


{
  const report=validateReceipt(valid,{
    requireHumanFixture:true,
    requireSpatialRuntimeAuthorization:true
  });
  assert.equal(report.valid,false);
  assert.ok(report.reasons.includes("SpatialRuntime authorization evidence missing"));
}


{
  const authBase={
    schema:"homeai_spatialruntime_authorization_receipt_v1",
    canonicalization:"sorted-json-number-normalized-v1",
    allow:true,
    case_id:"evidence-turn",
    source_step:0,
    source_revision:0,
    requested_patch_count:1,
    authorized_patches:[semanticPatch],
    blocked:[],
    rain:"dry",
    exterior_window_keys:[],
    trace_status:"completed",
    trace_hash:"c".repeat(64),
    safety_graph_fingerprint:"d".repeat(64),
    safety_forced_entities:[],
    commit_summary:{ready_to_dispatch:true}
  };
  const auth={...authBase,receipt_sha256:sha256Object(authBase)};
  const bindingBase={
    schema:"homeai_spatialruntime_physical_binding_v1",
    authorization_receipt_sha256:auth.receipt_sha256,
    authorization_trace_hash:auth.trace_hash,
    bindings:[{
      command_id:"windowpilot:1",
      status:"applied",
      authorization_patch_sha256:sha256Object(semanticPatch),
      physical_patch_sha256:sha256Object(semanticPatch),
      observation_sha256:sha256Object(feedback),
      observed_value:5
    }]
  };
  const binding={...bindingBase,binding_sha256:sha256Object(bindingBase)};
  const traceWithAuthorization=[{
    ...trace[0],
    authorized_patch_proposal:[semanticPatch],
    physical_authorization:auth,
    physical_authorization_binding:binding
  }];
  const receipt=buildReceipt({
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
    trace:traceWithAuthorization,
    driverCommands:[command,closeoutCommand],
    closeout:{
      attempted:true,already_closed:false,
      before_position_pct:5,after_position_pct:0,
      receipt:closeoutCommand
    },
    runtime,
    acousticFixture:fixture
  });
  const report=validateReceipt(receipt,{
    requireHumanFixture:true,
    requireSpatialRuntimeAuthorization:true
  });
  assert.equal(report.valid,true,JSON.stringify(report.reasons));

  const tampered=JSON.parse(JSON.stringify(receipt));
  tampered.semantic.committed_finals[0].physical_authorization_binding
    .bindings[0].observation_sha256="0".repeat(64);
  delete tampered.evidence_sha256;
  const resigned=finalizeReceipt(tampered);
  const bad=validateReceipt(resigned,{
    requireHumanFixture:true,
    requireSpatialRuntimeAuthorization:true
  });
  assert.equal(bad.valid,false);
  assert.ok(bad.reasons.includes(
    "SpatialRuntime binding observation hash does not match driver readback"
  ));
}
