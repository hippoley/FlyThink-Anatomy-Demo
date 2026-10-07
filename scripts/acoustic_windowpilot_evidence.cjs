"use strict";

const crypto=require("crypto");

const SCHEMA="flythink.acoustic_windowpilot_evidence.v1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function normalizeText(s){
  return String(s||"").trim().replace(/[\s，。！？、；：,.!?;:]+/g,"");
}
function characterErrorRate(expected,actual){
  const a=Array.from(normalizeText(expected));
  const b=Array.from(normalizeText(actual));
  if(a.length===0)return b.length===0?0:null;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const next=[i];
    for(let j=1;j<=b.length;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      next[j]=Math.min(
        next[j-1]+1,
        prev[j]+1,
        prev[j-1]+cost
      );
    }
    prev=next;
  }
  return prev[b.length]/a.length;
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
        turn_id:x.turn_id||null,
        physical_revision:x.physical_revision==null?null:Number(x.physical_revision),
        text:x.asr.text,
        targets:clone(x.target_resolution&&x.target_resolution.targets||[]),
        patches:clone(x.patch_proposal||[]),
        authorized_patches:clone(x.authorized_patch_proposal||x.patch_proposal||[]),
        physical_authorization:clone(x.physical_authorization||null),
        physical_authorization_binding:clone(x.physical_authorization_binding||null),
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

function validateReceipt(receipt,{requireHumanFixture=false,requireSpatialRuntimeAuthorization=false}={}){
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
  if(Number.isFinite(probe)&&Number.isFinite(tolerance)&&probe<=tolerance){
    reasons.push("probe target must exceed tolerance");
  }

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
  let transcriptCer=null;
  let maxCer=null;
  if(fixture&&fixture.expected_text&&normalizeText(finalText)){
    transcriptCer=characterErrorRate(fixture.expected_text,finalText);
    if(fixture.max_cer==null){
      if(requireHumanFixture)reasons.push("human acoustic fixture max CER missing");
    }else{
      maxCer=Number(fixture.max_cer);
      if(!Number.isFinite(maxCer)||maxCer<0||maxCer>1){
        reasons.push("acoustic fixture max CER invalid");
      }else if(transcriptCer!=null&&transcriptCer>maxCer){
        reasons.push("ASR CER exceeds frozen fixture threshold");
      }
    }
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
    if(!Array.isArray(committed.patches)||committed.patches.length!==1){
      reasons.push("expected exactly one committed semantic patch");
    }
    if(!Array.isArray(committed.thing_model)||committed.thing_model.length!==1){
      reasons.push("expected exactly one thing-model execution binding");
    }
    if(!Array.isArray(committed.feedback)||committed.feedback.length!==1){
      reasons.push("expected exactly one measured device feedback");
    }else if(committed.feedback.some(
      x=>!x||!x.evidence||x.evidence.measured!==true
    )){
      reasons.push("device feedback is not measured");
    }

    if(requireSpatialRuntimeAuthorization){
      const auth=committed.physical_authorization;
      if(!auth){
        reasons.push("SpatialRuntime authorization evidence missing");
      }else{
        if(auth.schema!=="homeai_spatialruntime_authorization_receipt_v1"){
          reasons.push("SpatialRuntime authorization schema mismatch");
        }
        if(auth.allow!==true){
          reasons.push("SpatialRuntime authorization did not allow");
        }
        if(auth.canonicalization!=="sorted-json-number-normalized-v1"){
          reasons.push("SpatialRuntime authorization canonicalization mismatch");
        }
        if(committed.turn_id&&auth.case_id!==committed.turn_id){
          reasons.push("SpatialRuntime authorization case/turn mismatch");
        }
        if(
          committed.physical_revision!=null&&
          Number(auth.source_revision)+1!==Number(committed.physical_revision)
        ){
          reasons.push("SpatialRuntime authorization revision does not precede committed physical revision");
        }
        if(!/^[0-9a-f]{64}$/.test(String(auth.trace_hash||""))){
          reasons.push("SpatialRuntime trace hash missing");
        }
        const saved=auth.receipt_sha256;
        const authBase=clone(auth);delete authBase.receipt_sha256;
        if(!saved||saved!==sha256Object(authBase)){
          reasons.push("SpatialRuntime authorization receipt SHA256 mismatch");
        }
        const authorized=committed.authorized_patches||[];
        if(!Array.isArray(authorized)||authorized.length!==1){
          reasons.push("expected exactly one SpatialRuntime-authorized patch");
        }

        const binding=committed.physical_authorization_binding;
        if(!binding){
          reasons.push("SpatialRuntime physical binding evidence missing");
        }else{
          if(binding.schema!=="homeai_spatialruntime_physical_binding_v1"){
            reasons.push("SpatialRuntime physical binding schema mismatch");
          }
          if(binding.authorization_receipt_sha256!==auth.receipt_sha256){
            reasons.push("SpatialRuntime binding authorization receipt mismatch");
          }
          if(binding.authorization_trace_hash!==auth.trace_hash){
            reasons.push("SpatialRuntime binding trace hash mismatch");
          }
          if(binding.case_id!==auth.case_id){
            reasons.push("SpatialRuntime physical binding case mismatch");
          }
          if(Number(binding.source_step)!==Number(auth.source_step)){
            reasons.push("SpatialRuntime physical binding source step mismatch");
          }
          if(Number(binding.source_revision)!==Number(auth.source_revision)){
            reasons.push("SpatialRuntime physical binding source revision mismatch");
          }
          const savedBinding=binding.binding_sha256;
          const bindingBase=clone(binding);delete bindingBase.binding_sha256;
          if(!savedBinding||savedBinding!==sha256Object(bindingBase)){
            reasons.push("SpatialRuntime physical binding SHA256 mismatch");
          }
          if(!Array.isArray(binding.bindings)||binding.bindings.length!==1){
            reasons.push("expected exactly one SpatialRuntime physical binding row");
          }else{
            const row=binding.bindings[0]||{};
            if(row.status!=="applied"){
              reasons.push("SpatialRuntime-bound physical command not applied");
            }
            if(row.authorization_patch_sha256!==row.physical_patch_sha256){
              reasons.push("SpatialRuntime authorized patch differs from physical patch");
            }
            if(!/^[0-9a-f]{64}$/.test(String(row.observation_sha256||""))){
              reasons.push("SpatialRuntime bound observation SHA256 missing");
            }
            const authValue=Number(row.authorized_value);
            const requestedValue=Number(row.requested_position_pct);
            const observedValue=Number(row.observed_value);
            const convergenceError=Number(row.convergence_error_pct);
            if(!Number.isFinite(authValue)){
              reasons.push("SpatialRuntime bound authorized value missing");
            }
            if(
              Number.isFinite(requestedValue)&&Number.isFinite(authValue)&&
              requestedValue!==authValue
            ){
              reasons.push("SpatialRuntime driver request differs from authorized value");
            }
            if(!Number.isFinite(observedValue)){
              reasons.push("SpatialRuntime bound observed value missing");
            }
            if(
              Number.isFinite(convergenceError)&&Number.isFinite(tolerance)&&
              convergenceError>tolerance
            ){
              reasons.push("SpatialRuntime authorized readback outside tolerance");
            }
          }
        }
      }
    }
  }

  const physical=receipt&&receipt.physical||{};
  const before=Number(physical.before_position_pct);
  if(!Number.isFinite(before)||before>tolerance){
    reasons.push("live probe did not start closed");
  }
  const commands=Array.isArray(physical.driver_commands)?physical.driver_commands:[];
  if(commands.length!==2){
    reasons.push("expected exactly one semantic command plus one closeout command");
  }
  function validateCausalCommand(command,label){
    if(!command)return;
    const beforeTick=Number(command.before_tick);
    const evidence=command.observation&&command.observation.evidence||{};
    const afterTick=Number(evidence.tick);
    const ackAtMs=Number(evidence.ack_at_ms);
    const receivedAtMs=Number(evidence.received_at_ms);
    if(evidence.source!=="windowpilot:/api/state"){
      reasons.push(label+" readback source is not WindowPilot state");
    }
    if(!Number.isFinite(beforeTick)||!Number.isFinite(afterTick)||afterTick<=beforeTick){
      reasons.push(label+" readback tick is not causally newer");
    }
    if(
      !Number.isFinite(ackAtMs)||
      !Number.isFinite(receivedAtMs)||
      receivedAtMs<ackAtMs
    ){
      reasons.push(label+" readback was not received after actuator ACK");
    }
    if(command.hardware_identity_before!==expected){
      reasons.push(label+" pre-actuation hardware identity mismatch");
    }
    if(command.hardware_identity_after!==expected){
      reasons.push(label+" post-readback hardware identity mismatch");
    }
    if(!command.readiness_before||command.readiness_before.physical_write_ready!==true){
      reasons.push(label+" command readiness was not write-ready");
    }
  }

  const semanticCommand=commands[0];
  if(semanticCommand){
    validateCausalCommand(semanticCommand,"semantic");
    if(semanticCommand.status!=="applied")reasons.push("semantic physical command not applied");
    const requested=Number(semanticCommand.requested_position_pct);
    if(!Number.isFinite(requested)||requested<=0||requested>5){
      reasons.push("semantic command position outside bounded probe");
    }
    if(requireSpatialRuntimeAuthorization&&committed){
      const authorized=committed.authorized_patches||[];
      const authorizedPct=Number(authorized[0]&&authorized[0].value);
      if(!Number.isFinite(authorizedPct)||authorizedPct!==requested){
        reasons.push("physical command does not match SpatialRuntime-authorized patch");
      }
      const binding=committed.physical_authorization_binding;
      const bindingRow=binding&&Array.isArray(binding.bindings)&&binding.bindings[0];
      if(bindingRow){
        if(bindingRow.physical_patch_sha256!==sha256Object(semanticCommand.patch)){
          reasons.push("SpatialRuntime binding physical patch hash does not match driver command");
        }
        if(bindingRow.observation_sha256!==sha256Object(semanticCommand.observation)){
          reasons.push("SpatialRuntime binding observation hash does not match driver readback");
        }
      }
    }
    const measured=Number(semanticCommand.observation&&semanticCommand.observation.evidence&&
      semanticCommand.observation.evidence.position_pct);
    if(!Number.isFinite(measured)||Math.abs(measured-requested)>tolerance){
      reasons.push("semantic command measured readback outside tolerance");
    }
    if(Number.isFinite(measured)&&measured<=tolerance){
      reasons.push("semantic command did not produce observable opening motion");
    }
  }

  const closeout=physical.closeout;
  if(!closeout)reasons.push("closeout evidence missing");
  else{
    if(closeout.attempted!==true||closeout.already_closed===true){
      reasons.push("closeout must be an explicit physical action");
    }
    if(!closeout.receipt||closeout.receipt.status!=="applied"){
      reasons.push("closeout physical command not applied");
    }
    const after=Number(closeout.after_position_pct);
    if(!Number.isFinite(after)||after>tolerance){
      reasons.push("closeout did not restore closed position");
    }
  }
  const closeoutCommand=commands[1];
  if(closeoutCommand){
    validateCausalCommand(closeoutCommand,"closeout");
    if(closeoutCommand.status!=="applied"){
      reasons.push("closeout driver command not applied");
    }
    const requested=Number(closeoutCommand.requested_position_pct);
    if(requested!==0){
      reasons.push("closeout driver command must request zero opening");
    }
    const measured=Number(
      closeoutCommand.observation&&closeoutCommand.observation.evidence&&
      closeoutCommand.observation.evidence.position_pct
    );
    if(!Number.isFinite(measured)||measured>tolerance){
      reasons.push("closeout driver readback is not closed");
    }
    if(
      closeout&&closeout.receipt&&
      sha256Object(closeout.receipt)!==sha256Object(closeoutCommand)
    ){
      reasons.push("closeout receipt does not match driver command");
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
    transcript_cer:transcriptCer,
    max_cer:maxCer,
    target:clone(target),
    hardware_identity:observed||null
  };
}

module.exports={
  SCHEMA,normalizeText,characterErrorRate,targetKey,canonical,sha256Object,asrEventsSha,
  finalizeReceipt,buildReceipt,validateReceipt
};
