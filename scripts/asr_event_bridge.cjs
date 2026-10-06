"use strict";

const KINDS=new Set(["partial","stable","final"]);

function normalizeText(text){
  return String(text||"").trim().replace(/\s+/g," ");
}

function validateAsrEvent(event){
  if(!event||event.type!=="asr_hypothesis")throw new Error("asr_event_type_required");
  if(!KINDS.has(event.kind))throw new Error("asr_event_kind_invalid");
  const text=normalizeText(event.text);
  if(!text)throw new Error("asr_event_text_required");
  if(!Number.isInteger(event.segment_id)||event.segment_id<1)throw new Error("asr_event_segment_id_invalid");
  if(!Number.isInteger(event.revision)||event.revision<1)throw new Error("asr_event_revision_invalid");
  return {...event,text};
}

class AsrEventSequenceGuard{
  constructor(){
    this.segmentId=null;
    this.lastRevision=0;
    this.lastText="";
    this.finalized=false;
  }

  accept(raw){
    const event=validateAsrEvent(raw);
    if(this.segmentId===null){
      this.segmentId=event.segment_id;
    }else if(event.segment_id!==this.segmentId){
      if(!this.finalized)throw new Error("asr_segment_advanced_before_final");
      if(event.segment_id!==this.segmentId+1)throw new Error("asr_segment_id_not_contiguous");
      this.segmentId=event.segment_id;
      this.lastRevision=0;
      this.lastText="";
      this.finalized=false;
    }else if(this.finalized){
      throw new Error("asr_event_after_segment_final");
    }

    if(event.revision<this.lastRevision)throw new Error("asr_revision_rollback");
    if(event.kind==="stable"){
      if(event.revision!==this.lastRevision)throw new Error("asr_stable_revision_mismatch");
      if(this.lastText&&event.text!==this.lastText)throw new Error("asr_stable_text_mismatch");
    }
    if(event.kind==="partial"){
      if(event.revision<=this.lastRevision&&event.text!==this.lastText){
        throw new Error("asr_partial_revision_not_advanced");
      }
    }
    if(event.kind==="final"&&event.revision<this.lastRevision){
      throw new Error("asr_final_revision_rollback");
    }

    this.lastRevision=event.revision;
    this.lastText=event.text;
    if(event.kind==="final")this.finalized=true;
    return event;
  }
}

function toStreamingSessionEvent(event){
  const e=validateAsrEvent(event);
  return {
    kind:e.kind,
    text:e.text,
    turn_id:"asr:"+String(e.segment_id),
    asr_meta:{
      source:e.source||null,
      segment_id:e.segment_id,
      revision:e.revision,
      audio_ms:e.audio_ms??null,
      final_reason:e.final_reason||null
    }
  };
}

module.exports={
  KINDS,
  normalizeText,
  validateAsrEvent,
  AsrEventSequenceGuard,
  toStreamingSessionEvent
};
