"use strict";

const fs=require("fs");
const path=require("path");

const {digestObject}=require("./pi_home_evidence_decision_receipt.cjs");
const {
  buildReceiptJournalSealFromRecords,
  verifyReceiptJournalSealPayload
}=require("./pi_home_decision_receipt_ledger.cjs");
const {
  verifyEvidenceRecords,
  withExclusiveJournalLock
}=require("./pi_home_evidence_journal.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function requireText(v,name){
  if(typeof v!=="string"||!v.trim())throw new Error(name+"_required");
  return v.trim();
}
function normalizeInstant(v,name){
  const text=requireText(v,name);
  const ms=Date.parse(text);
  if(!Number.isFinite(ms))throw new Error(name+"_invalid");
  return new Date(ms).toISOString();
}

function anchorCore(record){
  return {
    schema_version:"pi-home-receipt-journal-anchor-v1",
    generation:record.generation,
    published_at:record.published_at,
    actor:record.actor,
    reason:record.reason,
    seal:record.seal,
    previous_anchor_digest:record.previous_anchor_digest||null
  };
}

function anchorDigest(record){
  return digestObject(anchorCore(record));
}

function readAnchorRecords(file_path){
  if(!fs.existsSync(file_path))return [];
  const raw=fs.readFileSync(file_path,"utf8").trim();
  if(!raw)return [];
  return raw.split(/\r?\n/).filter(Boolean).map((line,index)=>{
    try{return JSON.parse(line)}
    catch(_){throw new Error("receipt_anchor_json_invalid_at:"+String(index+1))}
  });
}

function verifyAnchorRecords(records=[]){
  let previous=null;
  for(let i=0;i<(records||[]).length;i++){
    const record=records[i];
    const n=i+1;
    if(!record||record.schema_version!=="pi-home-receipt-journal-anchor-v1"){
      throw new Error("receipt_anchor_schema_invalid_at:"+n);
    }
    if(record.generation!==n){
      throw new Error("receipt_anchor_generation_invalid_at:"+n);
    }
    verifyReceiptJournalSealPayload(record.seal||{});
    if((record.previous_anchor_digest||null)!==(previous&&previous.anchor_digest||null)){
      throw new Error("receipt_anchor_previous_digest_mismatch_at:"+n);
    }
    const expected=anchorDigest(record);
    if(record.anchor_digest!==expected){
      throw new Error("receipt_anchor_digest_mismatch_at:"+n);
    }
    if(previous){
      if(Date.parse(record.published_at)<Date.parse(previous.published_at)){
        throw new Error("receipt_anchor_time_regression_at:"+n);
      }
      if(record.seal.journal_count<=previous.seal.journal_count){
        throw new Error("receipt_anchor_journal_count_not_advanced_at:"+n);
      }
      if(record.seal.receipt_count<previous.seal.receipt_count){
        throw new Error("receipt_anchor_receipt_count_regression_at:"+n);
      }
    }
    previous=record;
  }
  return {
    valid:true,
    generations:(records||[]).length,
    head_anchor_digest:previous?previous.anchor_digest:null,
    head_seal_digest:previous?previous.seal.seal_digest:null
  };
}

class FileReceiptJournalAnchorStore{
  constructor({file_path}={}){
    if(!file_path)throw new Error("receipt_anchor_path_required");
    this.file_path=file_path;
    this.records=readAnchorRecords(file_path);
    verifyAnchorRecords(this.records);
  }

  refresh(){
    const records=readAnchorRecords(this.file_path);
    verifyAnchorRecords(records);
    this.records=records;
    return this.snapshot();
  }

  publish(seal,{published_at,actor,reason}={}){
    verifyReceiptJournalSealPayload(seal);
    return withExclusiveJournalLock(this.file_path,()=>{
      const latest=readAnchorRecords(this.file_path);
      verifyAnchorRecords(latest);
      const previous=latest.length?latest[latest.length-1]:null;
      if(previous&&seal.journal_count<=previous.seal.journal_count){
        throw new Error("receipt_anchor_requires_journal_advance");
      }
      if(previous&&seal.receipt_count<previous.seal.receipt_count){
        throw new Error("receipt_anchor_receipt_count_regression");
      }
      const core={
        schema_version:"pi-home-receipt-journal-anchor-v1",
        generation:latest.length+1,
        published_at:normalizeInstant(published_at,"receipt_anchor_published_at"),
        actor:requireText(actor,"receipt_anchor_actor"),
        reason:requireText(reason,"receipt_anchor_reason"),
        seal:clone(seal),
        previous_anchor_digest:previous?previous.anchor_digest:null
      };
      if(previous&&Date.parse(core.published_at)<Date.parse(previous.published_at)){
        throw new Error("receipt_anchor_time_regression");
      }
      const record={...core,anchor_digest:digestObject(core)};
      verifyAnchorRecords([...latest,record]);
      fs.mkdirSync(path.dirname(this.file_path),{recursive:true});
      fs.appendFileSync(this.file_path,JSON.stringify(record)+"\n","utf8");
      this.records=[...latest,record];
      return clone(record);
    });
  }

  current(){
    this.refresh();
    return this.records.length?clone(this.records[this.records.length-1]):null;
  }

  verifyJournal(journal,anchor=null){
    if(!journal||typeof journal.verify!=="function"){
      throw new Error("evidence_journal_required");
    }
    if(typeof journal.refresh==="function")journal.refresh();
    verifyEvidenceRecords(journal.records||[]);
    const selected=anchor||this.current();
    if(!selected)throw new Error("receipt_anchor_required");
    verifyAnchorRecords(this.records);
    const known=this.records.find(x=>
      x.generation===selected.generation&&x.anchor_digest===selected.anchor_digest
    );
    if(!known)throw new Error("receipt_anchor_not_in_store");
    const count=selected.seal.journal_count;
    if((journal.records||[]).length<count){
      throw new Error("anchored_journal_truncated");
    }
    const prefix=(journal.records||[]).slice(0,count);
    const prefixSeal=buildReceiptJournalSealFromRecords(prefix);
    if(prefixSeal.seal_digest!==selected.seal.seal_digest){
      throw new Error("anchored_journal_prefix_mismatch");
    }
    return {
      valid:true,
      anchor_generation:selected.generation,
      anchor_digest:selected.anchor_digest,
      anchored_journal_count:count,
      current_journal_count:(journal.records||[]).length,
      unanchored_journal_count:(journal.records||[]).length-count,
      anchored_receipt_count:selected.seal.receipt_count,
      seal_digest:selected.seal.seal_digest
    };
  }

  snapshot(){
    const verified=verifyAnchorRecords(this.records);
    return {
      schema_version:"pi-home-receipt-journal-anchor-store-v1",
      file_path:this.file_path,
      ...verified,
      records:clone(this.records)
    };
  }
}

module.exports={
  FileReceiptJournalAnchorStore,
  readAnchorRecords,
  verifyAnchorRecords,
  anchorDigest
};
