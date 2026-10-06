"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

function canonical(v){
  if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
  if(v&&typeof v==="object"){
    return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  }
  return JSON.stringify(v);
}

function hashRecord(core){
  return crypto.createHash("sha256").update(canonical(core)).digest("hex");
}

function verifyEvidenceRecords(records=[]){
  let prev=null;
  for(let i=0;i<records.length;i++){
    const record=records[i];
    if(!record||record.schema_version!=="pi-home-evidence-event-v1"){
      throw new Error("journal_schema_invalid_at:"+String(i+1));
    }
    if(record.sequence!==i+1)throw new Error("journal_sequence_invalid_at:"+String(i+1));
    if((record.prev_hash||null)!==(prev||null)){
      throw new Error("journal_prev_hash_mismatch_at:"+String(i+1));
    }
    const core={
      schema_version:record.schema_version,
      sequence:record.sequence,
      type:record.type,
      actor:record.actor||null,
      refs:record.refs||null,
      payload:record.payload,
      prev_hash:record.prev_hash||null
    };
    const expected=hashRecord(core);
    if(record.hash!==expected)throw new Error("journal_hash_mismatch_at:"+String(i+1));
    prev=record.hash;
  }
  return {ok:true,count:records.length,head_hash:prev};
}

class DecisionEvidenceJournal{
  constructor({file_path}={}){
    if(!file_path)throw new Error("evidence_journal_path_required");
    this.file_path=file_path;
    this.records=[];
    if(fs.existsSync(file_path)){
      const raw=fs.readFileSync(file_path,"utf8").trim();
      if(raw){
        this.records=raw.split(/\r?\n/).filter(Boolean).map((line,index)=>{
          try{return JSON.parse(line)}
          catch(_){throw new Error("journal_json_invalid_at:"+String(index+1))}
        });
      }
    }
    verifyEvidenceRecords(this.records);
  }

  append({type,payload,actor=null,refs=null}={}){
    if(typeof type!=="string"||!type.trim())throw new Error("evidence_event_type_required");
    if(payload===undefined)throw new Error("evidence_event_payload_required");
    const sequence=this.records.length+1;
    const prev_hash=this.records.length?this.records[this.records.length-1].hash:null;
    const core={
      schema_version:"pi-home-evidence-event-v1",
      sequence,
      type:type.trim(),
      actor:actor||null,
      refs:refs||null,
      payload,
      prev_hash
    };
    const record={...core,hash:hashRecord(core)};
    verifyEvidenceRecords([...this.records,record]);
    fs.mkdirSync(path.dirname(this.file_path),{recursive:true});
    fs.appendFileSync(this.file_path,JSON.stringify(record)+"\n","utf8");
    this.records.push(record);
    return JSON.parse(JSON.stringify(record));
  }

  verify(){
    return verifyEvidenceRecords(this.records);
  }

  snapshot(){
    return {
      schema_version:"pi-home-evidence-journal-v1",
      file_path:this.file_path,
      ...this.verify(),
      records:JSON.parse(JSON.stringify(this.records))
    };
  }
}

module.exports={DecisionEvidenceJournal,verifyEvidenceRecords,hashRecord,canonical};
