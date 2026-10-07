"use strict";

const {
  deviceKey,
  diffLeaves,
  normalizeRuntime
}=require("./whole_home_patch_contract.cjs");
const {deriveContext}=require("./runtime_context_adapter.cjs");
const {
  MockThingDriver,
  executePhysicalTurn,
  evaluateQuarantinePreflight
}=require("./physical_runtime.cjs");
const {evaluateCommit}=require("./commit_gate.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b)}

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
  constructor({initialRuntime={},predictor,driver=null}={}){
    if(typeof predictor!=="function")throw new Error("streaming_predictor_required");
    this.runtime=normalizeRuntime(initialRuntime);
    this.predictor=predictor;
    this.driver=driver||new MockThingDriver(this.runtime);
    this.history=[];
    this.trace=[];
    this.sequence=0;
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
      ...deriveContext(this.runtime,this.history),
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
    if(gate.allow){
      const preflight=evaluateQuarantinePreflight(this.runtime,patches);
      if(!preflight.allow){
        const keys=preflight.violations.map(x=>x.device_key).join(",");
        error="semantic_preflight_blocked:device_quarantined:"+keys;
      }else{
        try{
          const applied=await executePhysicalTurn(
            this.runtime,
            patches,
            this.driver,
            {turn_id:event.turn_id||("stream:"+String(this.sequence+1))}
          );
          this.runtime=applied.runtime;
          receipts=applied.receipts||[];
          committed=receiptsApplied(receipts);
          if(!committed)error=receiptFailure(receipts)||"physical_commit_has_no_applied_receipt";
        }catch(e){
          error=String(e&&e.message||e);
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
        applied_patches:committed?clone(patches):[],
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
  receiptFailure
};
