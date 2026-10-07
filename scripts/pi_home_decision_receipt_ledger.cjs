"use strict";

const {digestObject,verifyEvidenceDecisionReceipt}=require("./pi_home_evidence_decision_receipt.cjs");
const {verifyEvidenceRecords}=require("./pi_home_evidence_journal.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function receiptEvents(records=[]){
  return (records||[]).filter(x=>x&&x.type==="EVIDENCE_DECISION_RECEIPT");
}

function receiptIndex(records=[]){
  return receiptEvents(records).map(event=>({
    sequence:event.sequence,
    decision_id:event.payload&&event.payload.decision_id||null,
    receipt_digest:event.payload&&event.payload.receipt_digest||null,
    event_hash:event.hash
  }));
}

function buildReceiptJournalSealFromRecords(records=[]){
  const verified=verifyEvidenceRecords(records||[]);
  const index=receiptIndex(records||[]);
  const core={
    schema_version:"pi-home-receipt-journal-seal-v1",
    journal_count:verified.count,
    journal_head_hash:verified.head_hash,
    receipt_count:index.length,
    receipt_index_digest:digestObject(index)
  };
  return {...core,seal_digest:digestObject(core)};
}

function verifyReceiptJournalSealPayload(seal={}){
  if(seal.schema_version!=="pi-home-receipt-journal-seal-v1"){
    throw new Error("receipt_journal_seal_schema_invalid");
  }
  const core=clone(seal);
  delete core.seal_digest;
  if(seal.seal_digest!==digestObject(core)){
    throw new Error("receipt_journal_seal_digest_mismatch");
  }
  return {valid:true,seal_digest:seal.seal_digest};
}

function buildReceiptJournalSeal(journal){
  if(!journal||typeof journal.verify!=="function")throw new Error("evidence_journal_required");
  if(typeof journal.refresh==="function")journal.refresh();
  return buildReceiptJournalSealFromRecords(journal.records||[]);
}

function verifyReceiptJournalSeal(journal,seal={}){
  if(!journal||typeof journal.verify!=="function")throw new Error("evidence_journal_required");
  verifyReceiptJournalSealPayload(seal);
  const current=buildReceiptJournalSeal(journal);
  if(seal.journal_count!==current.journal_count){
    throw new Error("receipt_journal_seal_count_mismatch");
  }
  if(seal.journal_head_hash!==current.journal_head_hash){
    throw new Error("receipt_journal_seal_head_mismatch");
  }
  if(seal.receipt_count!==current.receipt_count){
    throw new Error("receipt_journal_seal_receipt_count_mismatch");
  }
  if(seal.receipt_index_digest!==current.receipt_index_digest){
    throw new Error("receipt_journal_seal_receipt_index_mismatch");
  }
  return {
    valid:true,
    journal_count:current.journal_count,
    journal_head_hash:current.journal_head_hash,
    receipt_count:current.receipt_count,
    seal_digest:seal.seal_digest
  };
}

class EvidenceDecisionReceiptLedger{
  constructor({journal}={}){
    if(!journal||typeof journal.append!=="function"||typeof journal.verify!=="function"){
      throw new Error("evidence_journal_required");
    }
    this.journal=journal;
    this.assertUniqueHistory();
  }

  assertUniqueHistory(){
    const seenDecision=new Set();
    const seenReceipt=new Set();
    for(const item of receiptIndex(this.journal.records||[])){
      if(!item.decision_id)throw new Error("receipt_journal_decision_id_missing");
      if(!item.receipt_digest)throw new Error("receipt_journal_receipt_digest_missing");
      if(seenDecision.has(item.decision_id)){
        throw new Error("receipt_journal_duplicate_decision_id:"+item.decision_id);
      }
      if(seenReceipt.has(item.receipt_digest)){
        throw new Error("receipt_journal_duplicate_receipt_digest:"+item.receipt_digest);
      }
      seenDecision.add(item.decision_id);
      seenReceipt.add(item.receipt_digest);
    }
    return {decision_ids:seenDecision,receipt_digests:seenReceipt};
  }

  appendVerifiedReceipt(receipt,verificationContext={}){
    const verified=verifyEvidenceDecisionReceipt(receipt,verificationContext);
    const history=this.assertUniqueHistory();
    if(history.decision_ids.has(receipt.decision_id)){
      throw new Error("receipt_journal_duplicate_decision_id:"+receipt.decision_id);
    }
    if(history.receipt_digests.has(receipt.receipt_digest)){
      throw new Error("receipt_journal_duplicate_receipt_digest:"+receipt.receipt_digest);
    }
    const event=this.journal.append({
      type:"EVIDENCE_DECISION_RECEIPT",
      actor:receipt.actor,
      refs:{
        decision_id:receipt.decision_id,
        receipt_digest:receipt.receipt_digest,
        registry_digest:receipt.trust_snapshot&&receipt.trust_snapshot.registry_digest||null,
        snapshot_digest:receipt.trust_snapshot&&receipt.trust_snapshot.snapshot_digest||null,
        lineage_anchor_digest:receipt.trust_lineage_head&&receipt.trust_lineage_head.snapshot_digest||null
      },
      payload:receipt
    });
    return {
      verified,
      event,
      seal:buildReceiptJournalSeal(this.journal),
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
    return {
      schema_version:"pi-home-decision-receipt-ledger-v1",
      journal:this.journal.snapshot(),
      receipt_index:receiptIndex(this.journal.records||[]),
      seal:this.seal(),
      device_execution_authorized:false
    };
  }
}

module.exports={
  EvidenceDecisionReceiptLedger,
  receiptEvents,
  receiptIndex,
  buildReceiptJournalSealFromRecords,
  verifyReceiptJournalSealPayload,
  buildReceiptJournalSeal,
  verifyReceiptJournalSeal
};
