"use strict";

const assert=require("assert");
const {
  digestObject,
  buildExecutionReceipt,
  verifyExecutionReceipt
}=require("../scripts/execution_receipt.cjs");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");

const W={area:"客厅",entity:"窗",instance:"default"};
const OTHER={area:"卧室",entity:"窗",instance:"default"};
const action={op:"PATCH_SLOT",target:W,slot:"opening",value:5};
const contextualState={
  contract_version:"contextual-state.v1",
  conversation:{conversation_id:"conv-1",active_task_id:"task-1",pending_task_id:null,focused_target:W,referent_set:[W]},
  tasks:[],
  world:{devices:{
    "客厅::窗::default":{target:W,model_id:"CWDS-CA01",slots:{opening:0}}
  }},
  execution:{device_health:{},pending_ids:[],last_execution:null}
};
const request={
  request_version:"flythink-execution-request.v1",
  task_id:"task-1",
  goal:{type:"desired_state",metric:"ventilation"},
  resolved_targets:[W],
  constraints:[],
  candidate_actions:[action]
};
const proposal={
  schema_version:"flythink-execution-proposal.v1",
  proposal_id:"proposal-1",
  task_id:"task-1",
  decision:"PROPOSE",
  strategy:{kind:"bounded-open"},
  proposed_actions:[action],
  uncertainty:{score:0.1,reasons:[]},
  evidence_refs:["sensor:co2"],
  reason_code:"HIGH_CO2"
};
const authorization={
  schema:"homeai_spatialruntime_authorization_receipt_v1",
  allow:true,
  registry_digest:"registry-1",
  single_use:true
};

function clone(v){return JSON.parse(JSON.stringify(v))}
function reseal(receipt){
  const next=clone(receipt);
  delete next.receipt_sha256;
  next.receipt_sha256=digestObject(next);
  return next;
}
function refreshEvidenceDigest(receipt){
  receipt.physical.evidence_sha256=digestObject(receipt.physical.evidence);
  receipt.evidence_digest=digestObject({
    authorization:receipt.authorization,
    physical:receipt.physical,
    reconcile:receipt.reconcile,
    closeout:receipt.closeout
  });
  return reseal(receipt);
}
function verifiedPhysicalReceipt(){
  return {
    patch:clone(action),
    physical_patch:clone(action),
    command_id:"windowpilot:1",
    status:"applied",
    reason:null,
    observation:{
      target:clone(W),
      exists:true,
      slots:{opening:5},
      evidence:{
        source:"windowpilot:/api/state",
        measured:true,
        tick:11,
        ack_at_ms:1000,
        received_at_ms:1001
      }
    },
    ack:{ok:true,command_id:"ack-1"},
    before_tick:10,
    requested_position_pct:5,
    hardware_identity_before:"hw-1",
    hardware_identity_after:"hw-1",
    readiness_before:{physical_write_ready:true},
    readiness_after:{physical_write_ready:true},
    safety_stop:null
  };
}
function runtimes(){
  const before=normalizeRuntime({devices:{
    "客厅::窗::default":{
      key:"客厅::窗::default",area:"客厅",entity:"窗",instance:"default",
      slots:{opening:0}
    }
  }});
  const after=normalizeRuntime({devices:{
    "客厅::窗::default":{
      key:"客厅::窗::default",area:"客厅",entity:"窗",instance:"default",
      slots:{opening:5}
    }
  }});
  after.revisions.push({op:"PATCH_SLOT",turn_id:"task-1"});
  return {before,after};
}
function buildVerified(){
  const {before,after}=runtimes();
  return buildExecutionReceipt({
    contextual_state:contextualState,
    request,
    proposal,
    authorization,
    authorized_actions:[action],
    physical_receipts:[verifiedPhysicalReceipt()],
    before_runtime:before,
    after_runtime:after,
    status:"EXECUTED",
    physical_committed:true,
    atomic_batch:false,
    source_step:3,
    source_revision:8
  });
}

(()=>{
  // 1. Fully evidenced WindowPilot-like execution is independently verifiable.
  {
    const receipt=buildVerified();
    assert.equal(receipt.schema_version,"execution-receipt.v1");
    assert.equal(receipt.result,"APPLIED");
    assert.equal(receipt.verification.authorization_binding_verified,true);
    assert.equal(receipt.verification.logical_target_binding_verified,true);
    assert.equal(receipt.verification.target_binding_verified,true);
    assert.equal(receipt.verification.ack_verified,true);
    assert.equal(receipt.verification.fresh_readback_verified,true);
    assert.equal(receipt.verification.hardware_identity_verified,true);
    assert.equal(receipt.verification.measured_readback_verified,true);
    assert.equal(receipt.verification.physical_truth_verified,true);
    const verified=verifyExecutionReceipt(receipt);
    assert.equal(verified.valid,true);
    assert.equal(verified.physical_truth_verified,true);
  }

  // 2. Mutating the exact authorized action is detected even if outer receipt is re-sealed.
  {
    let forged=buildVerified();
    forged.authorization.authorized_actions[0].value=9;
    forged=reseal(forged);
    assert.throws(
      ()=>verifyExecutionReceipt(forged),
      /execution_receipt_authorized_actions_digest_mismatch/
    );
  }

  // 3. Mutating measured readback is detected even if evidence/top digests are refreshed.
  {
    let forged=buildVerified();
    forged.physical.evidence[0].observation.evidence.tick=9;
    forged=refreshEvidenceDigest(forged);
    assert.throws(
      ()=>verifyExecutionReceipt(forged),
      /execution_receipt_physical_checks_mismatch/
    );
  }

  // 4. ACK tampering cannot retain a verified causal receipt.
  {
    let forged=buildVerified();
    forged.physical.evidence[0].ack.ok=false;
    forged=refreshEvidenceDigest(forged);
    assert.throws(
      ()=>verifyExecutionReceipt(forged),
      /execution_receipt_physical_checks_mismatch/
    );
  }

  // 5. Hardware identity drift cannot retain a verified receipt.
  {
    let forged=buildVerified();
    forged.physical.evidence[0].hardware_identity.after="hw-swapped";
    forged=refreshEvidenceDigest(forged);
    assert.throws(
      ()=>verifyExecutionReceipt(forged),
      /execution_receipt_physical_checks_mismatch/
    );
  }

  // 6. Applied physical evidence with a different target is rejected at build time.
  {
    const bad=verifiedPhysicalReceipt();
    bad.observation.target=OTHER;
    const {before,after}=runtimes();
    assert.throws(
      ()=>buildExecutionReceipt({
        contextual_state:contextualState,
        request,
        proposal,
        authorization,
        authorized_actions:[action],
        physical_receipts:[bad],
        before_runtime:before,
        after_runtime:after,
        status:"EXECUTED",
        physical_committed:true
      }),
      /execution_receipt_target_binding_mismatch:0/
    );
  }

  // 7. "Applied" without causal physical evidence is valid as a record, but not verified truth.
  {
    const {before,after}=runtimes();
    const mock={
      patch:clone(action),
      physical_patch:clone(action),
      command_id:"mock:1",
      status:"applied",
      observation:{
        target:clone(W),
        exists:true,
        slots:{opening:5},
        evidence:{source:"mock",measured:false}
      }
    };
    const receipt=buildExecutionReceipt({
      contextual_state:contextualState,
      request,
      proposal,
      authorization,
      authorized_actions:[action],
      physical_receipts:[mock],
      before_runtime:before,
      after_runtime:after,
      status:"EXECUTED",
      physical_committed:true
    });
    const verified=verifyExecutionReceipt(receipt);
    assert.equal(verified.valid,true);
    assert.equal(verified.physical_committed,true);
    assert.equal(verified.physical_truth_verified,false);
    assert.equal(receipt.verification.ack_verified,false);
    assert.equal(receipt.verification.fresh_readback_verified,false);
    assert.equal(receipt.verification.hardware_identity_verified,false);
    assert.equal(receipt.verification.measured_readback_verified,false);
  }

  // 8. EXECUTED cannot be minted without applied physical evidence.
  {
    const {before,after}=runtimes();
    assert.throws(
      ()=>buildExecutionReceipt({
        contextual_state:contextualState,
        request,
        proposal,
        authorization,
        authorized_actions:[action],
        physical_receipts:[],
        before_runtime:before,
        after_runtime:after,
        status:"EXECUTED",
        physical_committed:true
      }),
      /execution_receipt_committed_requires_applied_receipts/
    );
  }

  // 9. Authorization binding cannot be detached from the physical semantic patch.
  {
    const physical=verifiedPhysicalReceipt();
    physical.patch={...clone(action),value:9};
    const {before,after}=runtimes();
    const receipt=buildExecutionReceipt({
      contextual_state:contextualState,
      request,
      proposal,
      authorization,
      authorized_actions:[action],
      physical_receipts:[physical],
      before_runtime:before,
      after_runtime:after,
      status:"EXECUTED",
      physical_committed:true
    });
    assert.equal(receipt.verification.authorization_binding_verified,false);
    assert.equal(receipt.verification.physical_truth_verified,false);
    const verified=verifyExecutionReceipt(receipt);
    assert.equal(verified.valid,true);
    assert.equal(verified.physical_truth_verified,false);
  }

  console.log(JSON.stringify({
    ok:true,
    cases:9,
    schema:"execution-receipt.v1",
    contract:"authorized action + physical patch + target + ACK + causal readback + hardware identity are digest-bound and independently checked"
  }));
})();
