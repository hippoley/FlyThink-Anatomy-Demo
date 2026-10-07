"use strict";

const {verifyExecutionReceipt}=require("./execution_receipt.cjs");
const {
  buildReceiptJournalSeal,
  verifyReceiptJournalSeal
}=require("./pi_home_decision_receipt_ledger.cjs");

const EVENT_TYPE="EXECUTION_RECEIPT_V1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function executionReceiptEvents(records=[]){
  return (records||[]).filter(x=>x&&x.type===EVENT_TYPE);
}

function executionReceiptIndex(records=[]){
  return executionReceiptEvents(records).map(event=>({
    sequence:event.sequence,
    task_id:event.payload&&event.payload.task_id||null,
    proposal_sha256:event.payload&&event.payload.proposal_sha256||null,
    receipt_sha256:event.payload&&event.payload.receipt_sha256||null,
    physical_truth_verified:
      !!(event.payload&&event.payload.verification&&
         event.payload.verification.physical_truth_verified),
    event_hash:event.hash
  }));
}

class ExecutionReceiptLedger{
  constructor({journal}={}){
    if(!journal||typeof journal.append!=="function"||typeof journal.verify!=="function"){
      throw new Error("evidence_journal_required");
    }
    this.journal=journal;
    this.assertUniqueHistory();
  }

  assertUniqueHistory(){
    const seen=new Set();
    for(const row of executionReceiptIndex(this.journal.records||[])){
      if(!row.receipt_sha256)throw new Error("execution_receipt_journal_digest_missing");
      if(seen.has(row.receipt_sha256)){
        throw new Error("execution_receipt_journal_duplicate_receipt:"+row.receipt_sha256);
      }
      seen.add(row.receipt_sha256);
    }
    return {receipt_digests:seen};
  }

  appendVerifiedReceipt(receipt,verificationContext={}){
    const verified=verifyExecutionReceipt(receipt,verificationContext);
    const history=this.assertUniqueHistory();
    if(history.receipt_digests.has(receipt.receipt_sha256)){
      throw new Error("execution_receipt_journal_duplicate_receipt:"+receipt.receipt_sha256);
    }
    const event=this.journal.append({
      type:EVENT_TYPE,
      actor:"flythink-execution-runtime",
      refs:{
        task_id:receipt.task_id||null,
        proposal_sha256:receipt.proposal_sha256||null,
        receipt_sha256:receipt.receipt_sha256,
        evidence_digest:receipt.evidence_digest||null,
        physical_truth_verified:verified.physical_truth_verified===true
      },
      payload:clone(receipt)
    });
    return {
      verified,
      event,
      seal:buildReceiptJournalSeal(this.journal),
      execution_receipt_index:executionReceiptIndex(this.journal.records||[]),
      device_execution_authorized:false
    };
  }

  seal(){
    return buildReceiptJournalSeal(this.journal);
  }

  verifySeal(seal){
    return verifyReceiptJournalSeal(this.journal,seal);
  }

  snapshot(){
    if(typeof this.journal.refresh==="function")this.journal.refresh();
    this.assertUniqueHistory();
    return {
      schema_version:"execution-receipt-ledger.v1",
      journal:this.journal.snapshot(),
      execution_receipt_index:executionReceiptIndex(this.journal.records||[]),
      seal:this.seal(),
      device_execution_authorized:false
    };
  }
}

module.exports={
  EVENT_TYPE,
  executionReceiptEvents,
  executionReceiptIndex,
  ExecutionReceiptLedger
};
