"use strict";

const crypto=require("crypto");

const SCHEMA="flythink.acoustic_windowpilot_evidence.v1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function normalizeText(s){
  return String(s||"").trim().replace(/[\s，。！？、；：,.!?;:]+/g,"");
}
function targetKey(t){
  return t&&[t.area,t.entity,t.instance||"default"].join("::");
}
function canonical(v){
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==="object"){
    const out={};
    for(const k of Object.keys(v).sort())out[k]=canonical(v[k]);
    return out;
  }
  return v;
}
function sha256Object(v){
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
}
function finalizeReceipt(payload){
  const base=clone(payload);
  delete base.evidence_sha256;
  return {...base,evidence_sha256:sha256Object(base)};
}
function asrEventsSha(events){
  return sha256Object((events||[]).map(x=>clone(x)));
}

function buildReceipt({
  mode,
  target,
  probeOpenPct,
  tolerancePct,
  expectedHardwareIdentity,
  readiness,
  beforePositionPct,
  acceptedEvents,
  trace,
  driverCommands,
  closeout,
  runtime,
  acousticFixture=null
}){
  const finals=(acceptedEvents||[]).filter(x=>x.kind==="final");
  const committed=(trace||[]).filter(x=>x.asr&&x.asr.is_final&&x.committed);
  const payload={
    schema:SCHEMA,
    truth:"acoustic_windowpilot_live_evidence_v1",
    mode,
    target:clone(target),
    probe_open_pct:Number(probeOpenPct),
    tolerance_pct:Number(tolerancePct),
    expected_hardware_identity:expectedHardwareIdentity||null,
    observed_hardware_identity:
      readiness&&readiness.hardware_identity
        ? readiness.hardware_identity.identity_sha256||null
        : null,
    readiness:{
      physical_write_ready:readiness&&readiness.physical_write_ready===true,
      write_blockers:clone(readiness&&readiness.write_blockers||[])
    },
    acoustic_fixture:clone(acousticFixture),
    asr:{
      events:clone(acceptedEvents||[]),
      events_sha256:asrEventsSha(acceptedEvents||[]),
      event_count:(acceptedEvents||[]).length,
      final_segments:finals.length,
      final_texts:finals.map(x=>x.text)
    },
    semantic:{
      speculative_physical_commands:(trace||[])
        .filter(x=>x.asr&&!x.asr.is_final)
        .reduce((n,x)=>n+(
          Number(x.physical_command_count_after||0)-
          Number(x.physical_command_count_before||0)
        ),0),
      committed_final_count:committed.length,
      committed_finals:committed.map(x=>({
        text:x.asr.text,
        targets:clone(x.target_resolution&&x.target_resolution.targets||[]),
        patches:clone(x.patch_proposal||[]),
        thing_model:clone(x.thing_model||[]),
        feedback:clone(x.feedback||[]),
        reconcile:clone(x.reconcile||null)
      }))
    },
    physical:{
      before_position_pct:Number(beforePositionPct),
      driver_commands:clone(driverCommands||[]),
      closeout:clone(closeout),
      final_runtime:clone(runtime)
    }
  };
  return finalizeReceipt(payload);
}

function validateReceipt(receipt,{requireHumanFixture=false}={}){
  const reasons=[];
  if(!receipt||receipt.schema!==SCHEMA)reasons.push("evidence schema mismatch");
  if(receipt&&receipt.mode!=="APPLY")reasons.push("live evidence must be APPLY mode");

  if(receipt){
    const saved=receipt.evidence_sha256;
    const base=clone(receipt);delete base.evidence_sha256;
    if(!saved||saved!==sha256Object(base))reasons.push("evidence SHA256 mismatch");
  }

  const target=receipt&&receipt.target;
  const tolerance=Number(receipt&&receipt.tolerance_pct);
  const probe=Number(receipt&&receipt.probe_open_pct);
  if(!target||!target.area||!target.entity)reasons.push("target missing");
  if(!Number.isFinite(probe)||probe<=0||probe>5)reasons.push("probe target outside (0,5]");
  if(!Number.isFinite(tolerance)||tolerance<0||tolerance>2)reasons.push("tolerance outside [0,2]");

  const expected=receipt&&receipt.expected_hardware_identity;
  const observed=receipt&&receipt.observed_hardware_identity;
  if(!expected)reasons.push("expected hardware identity missing");
  if(!observed)reasons.push("observed hardware identity missing");
  if(expected&&observed&&expected!==observed)reasons.push("hardware identity mismatch");
  if(receipt&&receipt.readiness&&receipt.readiness.physical_write_ready!==true){
    reasons.push("physical write was not ready");
  }

  const fixture=receipt&&receipt.acoustic_fixture;
  if(requireHumanFixture){
    if(!fixture){
      reasons.push("human acoustic fixture evidence missing");
    }else{
      if(fixture.source_kind!=="human_recording"){
        reasons.push("acoustic fixture is not a human recording");
      }
      if(!/^[0-9a-f]{64}$/.test(String(fixture.wav_sha256||""))){
        reasons.push("human acoustic fixture WAV SHA256 missing");
      }
      if(!/^[0-9a-f]{64}$/.test(String(fixture.manifest_sha256||""))){
        reasons.push("human acoustic fixture manifest SHA256 missing");
      }
    }
  }

  const asr=receipt&&receipt.asr||{};
  if(!Array.isArray(asr.events)||asr.events.length<1)reasons.push("ASR events missing");
  if(Array.isArray(asr.events)&&asr.events_sha256!==asrEventsSha(asr.events)){
    reasons.push("ASR event SHA256 mismatch");
  }
  if(Number(asr.final_segments)!==1)reasons.push("expected exactly one final ASR segment");
  const finalText=Array.isArray(asr.final_texts)&&asr.final_texts[0]||"";
  if(!normalizeText(finalText))reasons.push("final ASR transcript missing");
  if(fixture&&fixture.expected_text&&
     normalizeText(finalText)!==normalizeText(fixture.expected_text)){
    reasons.push("final ASR transcript does not match frozen fixture text");
  }

  const semantic=receipt&&receipt.semantic||{};
  if(Number(semantic.speculative_physical_commands)!==0){
    reasons.push("speculative ASR hypothesis reached physical driver");
  }
  if(Number(semantic.committed_final_count)!==1){
    reasons.push("expected exactly one committed final semantic turn");
  }
  const committed=Array.isArray(semantic.committed_finals)&&semantic.committed_finals[0];
  if(!committed)reasons.push("committed final evidence missing");
  if(committed){
    const targets=committed.targets||[];
    if(!targets.some(t=>targetKey(t)===targetKey(target))){
      reasons.push("semantic target does not match physical target");
    }
    if(!Array.isArray(committed.patches)||committed.patches.length<1){
      reasons.push("committed semantic patch missing");
    }
    if(!Array.isArray(committed.feedback)||committed.feedback.length<1){
      reasons.push("measured device feedback missing");
    }else if(committed.feedback.some(
      x=>!x||!x.evidence||x.evidence.measured!==true
    )){
      reasons.push("device feedback is not measured");
    }
  }

  const physical=receipt&&receipt.physical||{};
  const before=Number(physical.before_position_pct);
  if(!Number.isFinite(before)||before>tolerance){
    reasons.push("live probe did not start closed");
  }
  const commands=Array.isArray(physical.driver_commands)?physical.driver_commands:[];
  if(commands.length<1)reasons.push("physical command evidence missing");
  const semanticCommand=commands[0];
  if(semanticCommand){
    if(semanticCommand.status!=="applied")reasons.push("semantic physical command not applied");
    const requested=Number(semanticCommand.requested_position_pct);
    if(!Number.isFinite(requested)||requested<=0||requested>5){
      reasons.push("semantic command position outside bounded probe");
    }
    const measured=Number(semanticCommand.observation&&semanticCommand.observation.evidence&&
      semanticCommand.observation.evidence.position_pct);
    if(!Number.isFinite(measured)||Math.abs(measured-requested)>tolerance){
      reasons.push("semantic command measured readback outside tolerance");
    }
  }

  const closeout=physical.closeout;
  if(!closeout)reasons.push("closeout evidence missing");
  else{
    const after=Number(closeout.after_position_pct);
    if(!Number.isFinite(after)||after>tolerance){
      reasons.push("closeout did not restore closed position");
    }
  }

  const key=targetKey(target);
  const finalDevice=physical.final_runtime&&physical.final_runtime.devices&&
    physical.final_runtime.devices[key];
  if(!finalDevice)reasons.push("final reconciled target device missing");
  else{
    const opening=Number(finalDevice.slots&&finalDevice.slots.opening);
    if(!Number.isFinite(opening)||opening>tolerance){
      reasons.push("final reconciled runtime is not closed");
    }
  }

  return {
    valid:reasons.length===0,
    reasons,
    schema:receipt&&receipt.schema||null,
    evidence_sha256:receipt&&receipt.evidence_sha256||null,
    final_text:finalText||null,
    target:clone(target),
    hardware_identity:observed||null
  };
}

module.exports={
  SCHEMA,normalizeText,targetKey,canonical,sha256Object,asrEventsSha,
  finalizeReceipt,buildReceipt,validateReceipt
};
