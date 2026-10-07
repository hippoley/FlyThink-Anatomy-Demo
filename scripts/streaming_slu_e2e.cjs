"use strict";

const crypto=require("crypto");
const {
  deviceKey,
  diffLeaves,
  normalizeRuntime
}=require("./whole_home_patch_contract.cjs");
const {deriveSemanticContext}=require("./contextual_edge_slu_adapter.cjs");
const {
  MockThingDriver,
  executePhysicalTurn,
  evaluateQuarantinePreflight,
  markQuarantined
}=require("./physical_runtime.cjs");
const {evaluateCommit}=require("./commit_gate.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b)}


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
function patchIdentity(p){
  return {
    op:p&&p.op||null,
    target:clone(p&&p.target||null),
    slot:p&&p.slot||null
  };
}
function samePatchIdentity(a,b){
  return JSON.stringify(canonical(patchIdentity(a)))===JSON.stringify(canonical(patchIdentity(b)));
}
function bindSpatialRuntimeAuthorization(receipt,authorizedPatches,physicalReceipts,tolerancePct=1){
  if(!receipt||receipt.schema!=="homeai_spatialruntime_authorization_receipt_v1")return null;
  const rows=(physicalReceipts||[]).filter(x=>x&&x.local_only!==true);
  if(rows.length!==authorizedPatches.length){
    throw new Error("spatialruntime_physical_receipt_count_mismatch");
  }
  const bindings=[];
  for(let i=0;i<authorizedPatches.length;i++){
    const authorized=authorizedPatches[i];
    const row=rows[i];
    const physical=row&&clone(row.physical_patch||row.patch);
    if(!samePatchIdentity(authorized,physical)){
      throw new Error("spatialruntime_physical_patch_identity_mismatch:"+String(i));
    }
    const authorizedValue=Number(authorized&&authorized.value);
    const physicalValue=Number(physical&&physical.value);
    if(!Number.isFinite(authorizedValue)||!Number.isFinite(physicalValue)){
      throw new Error("spatialruntime_physical_patch_value_invalid:"+String(i));
    }
    if(physicalValue!==authorizedValue){
      throw new Error("spatialruntime_physical_patch_value_mismatch:"+String(i));
    }
    const requestedPosition=row.requested_position_pct==null
      ?null:Number(row.requested_position_pct);
    if(requestedPosition!=null&&(
      !Number.isFinite(requestedPosition)||requestedPosition!==authorizedValue
    )){
      throw new Error("spatialruntime_driver_requested_value_mismatch:"+String(i));
    }
    const observation=clone(row&&row.observation||null);
    if(!observation||!samePatchIdentity(
      authorized,
      {op:authorized.op,target:observation.target,slot:authorized.slot}
    )){
      throw new Error("spatialruntime_observation_target_mismatch:"+String(i));
    }
    const observedValue=Number(
      observation&&observation.slots&&observation.slots[authorized.slot]
    );
    if(!Number.isFinite(observedValue)){
      throw new Error("spatialruntime_observation_value_missing:"+String(i));
    }
    const convergenceError=Math.abs(observedValue-authorizedValue);
    if(
      row.status==="applied"&&(
        !Number.isFinite(Number(tolerancePct))||
        convergenceError>Number(tolerancePct)
      )
    ){
      throw new Error("spatialruntime_observation_outside_authorized_tolerance:"+String(i));
    }
    bindings.push({
      command_id:row.command_id||null,
      status:row.status||null,
      authorization_patch_sha256:sha256Object(authorized),
      physical_patch_sha256:sha256Object(physical),
      observation_sha256:sha256Object(observation),
      authorized_value:authorizedValue,
      requested_position_pct:requestedPosition,
      observed_value:observedValue,
      convergence_error_pct:convergenceError,
      convergence_tolerance_pct:Number(tolerancePct)
    });
  }
  const body={
    schema:"homeai_spatialruntime_physical_binding_v1",
    case_id:receipt.case_id,
    source_step:receipt.source_step,
    source_revision:receipt.source_revision,
    spatialruntime_pin:receipt.spatialruntime_pin||null,
    authorization_receipt_sha256:receipt.receipt_sha256,
    authorization_trace_hash:receipt.trace_hash,
    bindings
  };
  return {...body,binding_sha256:sha256Object(body)};
}

function targetsOf(patches){
  const out=[];
  const seen=new Set();
  for(const p of patches||[]){
    const rows=p&&p.target?[p.target]:((p&&p.targets)||[]);
    for(const t of rows){
      if(!t)continue;
      const k=deviceKey(t);
      if(seen.has(k))continue;
      seen.add(k);out.push(clone(t));
    }
  }
  return out;
}

function bindingFor(runtime,patch){
  const t=patch&&patch.target;
  if(!t)return null;
  const d=(runtime.devices||{})[deviceKey(t)]||null;
  return {
    target:clone(t),
    model_id:d&&d.model_id||null,
    slot:patch.slot||null,
    op:patch.op||null
  };
}

function receiptsApplied(receipts){
  return Array.isArray(receipts)&&receipts.length>0&&receipts.every(
    x=>x&&(x.local_only===true||x.status==="applied")
  );
}

function receiptFailure(receipts){
  const failed=(receipts||[]).filter(
    x=>!x||(x.local_only!==true&&x.status!=="applied")
  );
  if(!failed.length)return null;
  return "physical_receipt_not_applied:"+failed.map(
    x=>x&&x.status||"missing_status"
  ).join(",");
}

class StreamingHomeSession{
  constructor({initialRuntime={},predictor,driver=null,physicalAuthorizer=null,physicalAuthorizationTolerancePct=1}={}){
    if(typeof predictor!=="function")throw new Error("streaming_predictor_required");
    this.runtime=normalizeRuntime(initialRuntime);
    this.predictor=predictor;
    this.driver=driver||new MockThingDriver(this.runtime);
    this.physicalAuthorizer=physicalAuthorizer;
    this.physicalAuthorizationTolerancePct=Number(physicalAuthorizationTolerancePct);
    if(!Number.isFinite(this.physicalAuthorizationTolerancePct)||this.physicalAuthorizationTolerancePct<0){
      throw new Error("physical_authorization_tolerance_invalid");
    }
    this.history=[];
    this.trace=[];
    this.sequence=0;
    this.physicalRevision=0;
  }

  commandCount(){
    return Array.isArray(this.driver&&this.driver.commands)?this.driver.commands.length:null;
  }

  async process(event={}){
    const kind=String(event.kind||"").toLowerCase();
    if(!["partial","stable","final"].includes(kind)){
      throw new Error("unsupported_asr_hypothesis_kind:"+kind);
    }
    if(typeof event.text!=="string"||!event.text.trim()){
      throw new Error("streaming_hypothesis_text_required");
    }

    const before=normalizeRuntime(this.runtime);
    const beforeCommands=this.commandCount();
    const context={
      ...deriveSemanticContext(this.runtime,this.history),
      ...(event.context_hint||{})
    };
    const prediction=await this.predictor({
      text:event.text,
      context,
      background:{...context,...(event.background||{})}
    });
    const patches=Array.isArray(prediction&&prediction.patches)?prediction.patches:[];
    const gate=evaluateCommit({
      decision:prediction&&prediction.decision,
      patches,
      commit_state:event.commit_state||kind,
      mode:"streaming"
    });

    let receipts=[];
    let committed=false;
    let error=null;
    let physicalAuthorization=null;
    let physicalAuthorizationBinding=null;
    let authorizedPatches=clone(patches);
    if(gate.allow){
      const preflight=evaluateQuarantinePreflight(this.runtime,patches);
      if(!preflight.allow){
        const keys=preflight.violations.map(x=>x.device_key).join(",");
        error="semantic_preflight_blocked:device_quarantined:"+keys;
      }else{
        try{
          if(this.physicalAuthorizer){
            const authorization=await this.physicalAuthorizer({
              runtime:clone(this.runtime),
              patches:clone(patches),
              event:clone(event),
              context:clone(context),
              prediction:clone(prediction),
              source_step:this.physicalRevision,
              source_revision:this.physicalRevision
            });
            if(!authorization||authorization.allow!==true){
              throw new Error("physical_authorizer_did_not_allow");
            }
            if(!Array.isArray(authorization.patches)||authorization.patches.length!==patches.length){
              throw new Error("physical_authorizer_invalid_patches");
            }
            authorizedPatches=clone(authorization.patches);
            physicalAuthorization=clone(authorization.receipt||authorization);
          }
          const turnId=event.turn_id||("stream:"+String(this.sequence+1));
          const applied=await executePhysicalTurn(
            this.runtime,
            authorizedPatches,
            this.driver,
            {turn_id:turnId}
          );
          const candidateReceipts=applied.receipts||[];
          // Physical facts must survive even when authorization↔execution binding fails.
          this.runtime=applied.runtime;
          receipts=candidateReceipts;
          committed=receiptsApplied(receipts);
          if(this.physicalAuthorizer&&receipts.length){
            try{
              physicalAuthorizationBinding=bindSpatialRuntimeAuthorization(
                physicalAuthorization,
                authorizedPatches,
                candidateReceipts,
                this.physicalAuthorizationTolerancePct
              );
            }catch(bindingError){
              committed=false;
              error="physical_authorization_binding_failed:"+String(
                bindingError&&bindingError.message||bindingError
              );
              for(const authorized of authorizedPatches){
                if(!authorized||!authorized.target)continue;
                markQuarantined(
                  this.runtime,
                  authorized.target,
                  {
                    status:"uncertain",
                    reason:error,
                    id:(candidateReceipts[0]&&candidateReceipts[0].command_id)||null
                  },
                  turnId
                );
              }
            }
          }
          if(committed)this.physicalRevision++;
          if(!committed&&!error)error=receiptFailure(receipts)||"physical_commit_has_no_applied_receipt";
        }catch(e){
          error=String(e&&e.message||e);
          if(!physicalAuthorization&&e&&e.receipt)physicalAuthorization=clone(e.receipt);
        }
      }
    }

    const after=normalizeRuntime(this.runtime);
    const afterCommands=this.commandCount();

    if(!gate.allow){
      if(!eq(before,after))throw new Error("speculative_hypothesis_mutated_runtime");
      if(beforeCommands!=null&&afterCommands!==beforeCommands){
        throw new Error("speculative_hypothesis_reached_physical_driver");
      }
    }

    const feedback=receipts
      .filter(x=>x&&x.observation)
      .map(x=>clone(x.observation));
    const thingModel=receipts.map(x=>({
      semantic_patch:clone(x.patch),
      physical_patch:clone(x.physical_patch||x.patch),
      binding:bindingFor(before,x.physical_patch||x.patch),
      command_id:x.command_id||null,
      status:x.status||null,
      reason:x.reason||null
    }));

    const row={
      sequence:++this.sequence,
      physical_revision:this.physicalRevision,
      turn_id:event.turn_id||null,
      asr:{
        kind,
        text:event.text,
        is_final:kind==="final"
      },
      semantic:{
        decision:prediction&&prediction.decision||null,
        confidence:(prediction&&prediction.confidence)??null,
        raw:clone(prediction&&prediction.semantic_raw||null)
      },
      target_resolution:{
        targets:targetsOf(patches)
      },
      patch_proposal:clone(patches),
      physical_authorization:clone(physicalAuthorization),
      physical_authorization_binding:clone(physicalAuthorizationBinding),
      authorized_patch_proposal:clone(authorizedPatches),
      commit_gate:clone(gate),
      thing_model:thingModel,
      feedback,
      reconcile:{
        changed_device_paths:diffLeaves(before.devices||{},after.devices||{}),
        before_device_state:clone(before.devices),
        after_device_state:clone(after.devices)
      },
      committed,
      error,
      physical_command_count_before:beforeCommands,
      physical_command_count_after:afterCommands
    };
    this.trace.push(row);

    if(kind==="final"){
      this.history.push({
        text:event.text,
        outcome:error?"INVALID":(prediction&&prediction.decision||null),
        predicted:prediction&&prediction.decision||null,
        committed,
        semantic_patches:clone(patches),
        applied_patches:committed?clone(authorizedPatches):[],
        physical_authorization:clone(physicalAuthorization),
        physical_authorization_binding:clone(physicalAuthorizationBinding),
        physical_receipts:clone(receipts),
        commit_gate:clone(gate),
        error,
        context:clone(context)
      });
    }
    return row;
  }
}

async function runStreamingSequence(sequence,options={}){
  const session=new StreamingHomeSession(options);
  for(const event of sequence||[])await session.process(event);
  return {
    runtime:session.runtime,
    trace:session.trace,
    history:session.history,
    physical_commands:session.commandCount()
  };
}

module.exports={
  StreamingHomeSession,
  runStreamingSequence,
  targetsOf,
  receiptsApplied,
  receiptFailure,
  bindSpatialRuntimeAuthorization
};
