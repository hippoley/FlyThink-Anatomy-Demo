"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");

const {
  digestObject,
  buildExecutionReceipt,
  verifyExecutionReceipt
}=require("../scripts/execution_receipt.cjs");
const {
  DecisionEvidenceJournal,
  hashRecord
}=require("../scripts/pi_home_evidence_journal.cjs");
const {
  FileReceiptJournalAnchorStore
}=require("../scripts/pi_home_journal_anchor_store.cjs");
const {
  EVENT_TYPE,
  ExecutionReceiptLedger
}=require("../scripts/execution_receipt_ledger.cjs");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");

function clone(v){return JSON.parse(JSON.stringify(v))}

function buildReceipt(taskId="task-1",opening=5){
  const target={area:"客厅",entity:"窗",instance:"default"};
  const action={op:"PATCH_SLOT",target,slot:"opening",value:opening};
  const contextualState={
    contract_version:"contextual-state.v1",
    conversation:{
      conversation_id:"conv-"+taskId,
      active_task_id:taskId,
      pending_task_id:null,
      focused_target:target,
      referent_set:[target]
    },
    tasks:[],
    world:{devices:{
      "客厅::窗::default":{
        target,
        model_id:"CWDS-CA01",
        slots:{opening:0}
      }
    }},
    execution:{device_health:{},pending_ids:[],last_execution:null}
  };
  const request={
    request_version:"flythink-execution-request.v1",
    task_id:taskId,
    goal:{type:"desired_state",metric:"ventilation"},
    resolved_targets:[target],
    constraints:[],
    candidate_actions:[action]
  };
  const proposal={
    schema_version:"flythink-execution-proposal.v1",
    proposal_id:"proposal-"+taskId,
    task_id:taskId,
    decision:"PROPOSE",
    strategy:{kind:"bounded-open"},
    proposed_actions:[action],
    uncertainty:{score:0.1,reasons:[]},
    evidence_refs:["sensor:co2"],
    reason_code:"HIGH_CO2"
  };
  const authBase={
    schema:"homeai_spatialruntime_authorization_receipt_v1",
    allow:true,
    authorized_patches:[action],
    trace_hash:"a".repeat(64)
  };
  const authorization={
    ...authBase,
    receipt_sha256:digestObject(authBase)
  };
  const before=normalizeRuntime({devices:{
    "客厅::窗::default":{
      key:"客厅::窗::default",
      area:"客厅",entity:"窗",instance:"default",
      slots:{opening:0}
    }
  }});
  const after=normalizeRuntime({devices:{
    "客厅::窗::default":{
      key:"客厅::窗::default",
      area:"客厅",entity:"窗",instance:"default",
      slots:{opening}
    }
  }});
  after.revisions.push({op:"PATCH_SLOT",turn_id:taskId});
  const physicalReceipt={
    patch:clone(action),
    physical_patch:clone(action),
    command_id:"windowpilot:"+taskId,
    status:"applied",
    observation:{
      target,
      exists:true,
      slots:{opening},
      evidence:{
        source:"windowpilot:/api/state",
        measured:true,
        position_pct:opening,
        tick:11,
        ack_at_ms:1000,
        received_at_ms:1001
      }
    },
    ack:{ok:true,command_id:"ack-"+taskId},
    before_tick:10,
    requested_position_pct:opening,
    hardware_identity_before:"hw-1",
    hardware_identity_after:"hw-1",
    readiness_before:{physical_write_ready:true},
    readiness_after:{physical_write_ready:true}
  };
  return buildExecutionReceipt({
    contextual_state:contextualState,
    request,
    proposal,
    authorization,
    authorized_actions:[action],
    physical_receipts:[physicalReceipt],
    before_runtime:before,
    after_runtime:after,
    status:"EXECUTED",
    physical_committed:true,
    source_step:1,
    source_revision:1
  });
}

function resealExecutionReceipt(receipt){
  const next=clone(receipt);
  next.evidence_digest=digestObject({
    authorization:next.authorization,
    physical:next.physical,
    reconcile:next.reconcile,
    closeout:next.closeout
  });
  delete next.receipt_sha256;
  next.receipt_sha256=digestObject(next);
  return next;
}

function rewriteJournalRecordWithReceipt(record,receipt){
  const core={
    schema_version:record.schema_version,
    sequence:record.sequence,
    type:record.type,
    actor:record.actor||null,
    refs:{
      ...(record.refs||{}),
      receipt_sha256:receipt.receipt_sha256,
      evidence_digest:receipt.evidence_digest,
      physical_truth_verified:
        receipt.verification&&receipt.verification.physical_truth_verified===true
    },
    payload:clone(receipt),
    prev_hash:record.prev_hash||null
  };
  return {...core,hash:hashRecord(core)};
}

(()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-exec-ledger-"));
  const journalPath=path.join(dir,"execution.jsonl");
  const anchorPath=path.join(dir,"anchors.jsonl");

  const journal=new DecisionEvidenceJournal({file_path:journalPath});
  const ledger=new ExecutionReceiptLedger({journal});
  const receipt=buildReceipt();

  // 1. A verified physical receipt can be appended to the existing hash-chain journal.
  const appended=ledger.appendVerifiedReceipt(receipt);
  assert.equal(appended.verified.valid,true);
  assert.equal(appended.verified.physical_truth_verified,true);
  assert.equal(appended.event.type,EVENT_TYPE);
  assert.equal(appended.event.payload.receipt_sha256,receipt.receipt_sha256);
  assert.equal(appended.execution_receipt_index.length,1);
  assert.equal(appended.execution_receipt_index[0].physical_truth_verified,true);
  assert.equal(appended.seal.journal_count,1);

  // 2. Duplicate receipt insertion is rejected.
  assert.throws(
    ()=>ledger.appendVerifiedReceipt(receipt),
    /execution_receipt_journal_duplicate_receipt/
  );

  // 3. Tampered receipt is rejected before it reaches the journal.
  const tampered=clone(receipt);
  tampered.reason="forged";
  assert.throws(
    ()=>ledger.appendVerifiedReceipt(tampered),
    /execution_receipt_digest_mismatch/
  );

  // 4. Existing seal can be published by the existing anchor store without new PKI.
  const anchors=new FileReceiptJournalAnchorStore({file_path:anchorPath});
  const anchor=anchors.publish(appended.seal,{
    published_at:"2026-10-07T06:00:00.000Z",
    actor:"flythink-ci",
    reason:"anchor execution receipt prefix"
  });
  const anchored=anchors.verifyJournal(journal,anchor);
  assert.equal(anchored.valid,true);
  assert.equal(anchored.anchored_journal_count,1);

  // 5. New valid receipts may extend the journal after the anchored prefix.
  const receipt2=buildReceipt("task-2",4);
  const appended2=ledger.appendVerifiedReceipt(receipt2);
  assert.equal(appended2.verified.physical_truth_verified,true);
  const extended=anchors.verifyJournal(journal,anchor);
  assert.equal(extended.valid,true);
  assert.equal(extended.anchored_journal_count,1);
  assert.equal(extended.current_journal_count,2);
  assert.equal(extended.unanchored_journal_count,1);

  // 6. Rewrite the anchored receipt, re-seal the receipt and rebuild the local hash chain.
  //    The forged journal is internally self-consistent, but the external anchor catches it.
  const originalRecords=clone(journal.records);
  let forgedReceipt=clone(originalRecords[0].payload);
  forgedReceipt.reason="rewritten-after-anchor";
  forgedReceipt=resealExecutionReceipt(forgedReceipt);
  assert.equal(verifyExecutionReceipt(forgedReceipt).valid,true);

  const forgedFirst=rewriteJournalRecordWithReceipt(originalRecords[0],forgedReceipt);
  const secondCore={
    schema_version:originalRecords[1].schema_version,
    sequence:originalRecords[1].sequence,
    type:originalRecords[1].type,
    actor:originalRecords[1].actor||null,
    refs:clone(originalRecords[1].refs||null),
    payload:clone(originalRecords[1].payload),
    prev_hash:forgedFirst.hash
  };
  const forgedSecond={...secondCore,hash:hashRecord(secondCore)};
  fs.writeFileSync(
    journalPath,
    JSON.stringify(forgedFirst)+"\n"+JSON.stringify(forgedSecond)+"\n",
    "utf8"
  );

  const forgedJournal=new DecisionEvidenceJournal({file_path:journalPath});
  assert.equal(forgedJournal.verify().ok,true,"forged local chain should be self-consistent");
  assert.throws(
    ()=>anchors.verifyJournal(forgedJournal,anchor),
    /anchored_journal_prefix_mismatch/
  );

  console.log(JSON.stringify({
    ok:true,
    cases:6,
    schema:"execution-receipt-ledger.v1",
    contract:"verified execution receipts reuse the existing append-only journal/seal/anchor; anchored prefix detects whole-receipt and whole-chain rewrites"
  }));
})();
