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
const completionCriterion={
  version:"windowpilot-completion-criterion.v1",
  target:W,
  slot:"opening",
  predicate:"abs(observed_position_pct-requested_position_pct)<=tolerance_pct",
  requested_position_pct:5,
  tolerance_pct:1,
  require_fresh_readback:true,
  witness_source:"windowpilot:/api/state",
  witness_method:"windowpilot-state-readback",
  expected_hardware_identity_sha256:"hw-1"
};
const completionCriterionSha=digestObject(completionCriterion);
const contextualState={
  contract_version:"contextual-state.v1",
  context_revision:7,
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
const authorizationBase={
  schema:"homeai_spatialruntime_authorization_receipt_v1",
  allow:true,
  patch_digest:digestObject([action]),
  registry_digest:digestObject({
    "客厅::窗::default":{model_id:"CWDS-CA01"}
  }),
  spatialruntime_commit_sha:null,
  trace_hash:"c".repeat(64),
  single_use:true,
  case_id:"task-1",
  source_step:3,
  source_revision:8,
  authorized_patches:[action],
  completion_criteria:[{
    criterion:completionCriterion,
    criterion_sha256:completionCriterionSha
  }],
  completion_criteria_sha256:digestObject([{
    criterion:completionCriterion,
    criterion_sha256:completionCriterionSha
  }])
};
authorizationBase.authorization_id=digestObject({
  case_id:authorizationBase.case_id,
  source_step:authorizationBase.source_step,
  source_revision:authorizationBase.source_revision,
  patch_digest:authorizationBase.patch_digest,
  registry_digest:authorizationBase.registry_digest,
  completion_criteria_sha256:authorizationBase.completion_criteria_sha256,
  spatialruntime_commit_sha:authorizationBase.spatialruntime_commit_sha,
  trace_hash:authorizationBase.trace_hash
});
const authorization={
  ...authorizationBase,
  receipt_sha256:digestObject(authorizationBase)
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
        position_pct:5,
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
    completion_criterion:clone(completionCriterion),
    completion_criterion_sha256:completionCriterionSha,
    witness:{
      witness_id:"windowpilot-state:hw-1",
      source:"windowpilot:/api/state",
      method:"windowpilot-state-readback",
      hardware_identity_sha256:"hw-1",
      independent:false
    },
    criterion_fixed_at_ms:999,
    observation_window:{
      criterion_fixed_at_ms:999,
      ack_at_ms:1000,
      received_at_ms:1001
    },
    safety_stop:null
  };
}
function runtimes(){
  const before=normalizeRuntime({devices:{
    "客厅::窗::default":{
      key:"客厅::窗::default",area:"客厅",entity:"窗",instance:"default",
      model_id:"CWDS-CA01",slots:{opening:0}
    }
  }});
  const after=normalizeRuntime({devices:{
    "客厅::窗::default":{
      key:"客厅::窗::default",area:"客厅",entity:"窗",instance:"default",
      model_id:"CWDS-CA01",slots:{opening:5}
    }
  }});
  after.revisions.push({op:"PATCH_SLOT",turn_id:"task-1"});
  return {before,after};
}
function verifyWithRuntime(receipt,extra={}){
  const {before,after}=runtimes();
  return verifyExecutionReceipt(receipt,{
    before_runtime:before,
    after_runtime:after,
    ...extra
  });
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
    assert.equal(receipt.verification.physical_completion_verified,true);
    assert.equal(receipt.verification.independent_object_outcome_verified,false);
    assert.equal(
      receipt.verification.completion_criterion_authorization_binding_verified,
      true
    );
    const {before,after}=runtimes();
    const verified=verifyExecutionReceipt(receipt,{
      contextual_state:contextualState,
      request,
      proposal,
      before_runtime:before,
      after_runtime:after
    });
    assert.equal(verified.valid,true);
    assert.equal(verified.physical_truth_verified,true);
    assert.equal(verified.physical_completion_verified,true);
    assert.equal(verified.authorization_trust_domain_key_source_verified,false);
    assert.equal(verified.authorization_issuer_authenticated_verified,false);
    assert.equal(verified.independent_object_outcome_verified,false);
  }

  // 2. Mutating the exact authorized action is detected even if outer receipt is re-sealed.
  {
    let forged=buildVerified();
    forged.authorization.authorized_actions[0].value=9;
    forged=reseal(forged);
    assert.throws(
      ()=>verifyWithRuntime(forged),
      /execution_receipt_authorized_actions_digest_mismatch/
    );
  }

  // 3. Mutating measured readback is detected even if evidence/top digests are refreshed.
  {
    let forged=buildVerified();
    forged.physical.evidence[0].observation.evidence.tick=9;
    forged=refreshEvidenceDigest(forged);
    assert.throws(
      ()=>verifyWithRuntime(forged),
      /execution_receipt_physical_checks_mismatch/
    );
  }

  // 4. ACK tampering cannot retain a verified causal receipt.
  {
    let forged=buildVerified();
    forged.physical.evidence[0].ack.ok=false;
    forged=refreshEvidenceDigest(forged);
    assert.throws(
      ()=>verifyWithRuntime(forged),
      /execution_receipt_physical_checks_mismatch/
    );
  }

  // 5. Hardware identity drift cannot retain a verified receipt.
  {
    let forged=buildVerified();
    forged.physical.evidence[0].hardware_identity.after="hw-swapped";
    forged=refreshEvidenceDigest(forged);
    assert.throws(
      ()=>verifyWithRuntime(forged),
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
    const verified=verifyExecutionReceipt(receipt,{
      before_runtime:before,
      after_runtime:after
    });
    assert.equal(verified.valid,true);
    assert.equal(verified.physical_committed,true);
    assert.equal(verified.physical_truth_verified,false);
    assert.equal(receipt.result,"APPLIED_UNVERIFIED");
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
    assert.throws(
      ()=>buildExecutionReceipt({
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
      }),
      /execution_receipt_authorization_binding_mismatch/
    );
  }

  // 10. Authorization receipt may self-reseal, but cannot change the exact authorized action.
  {
    let forged=buildVerified();
    forged.authorization.receipt.authorized_patches[0].value=9;
    const authBase=clone(forged.authorization.receipt);
    delete authBase.receipt_sha256;
    forged.authorization.receipt.receipt_sha256=digestObject(authBase);
    forged.authorization.receipt_sha256=digestObject(forged.authorization.receipt);
    forged.evidence_digest=digestObject({
      authorization:forged.authorization,
      physical:forged.physical,
      reconcile:forged.reconcile,
      closeout:forged.closeout
    });
    forged=reseal(forged);
    assert.throws(
      ()=>verifyWithRuntime(forged),
      /execution_receipt_verification_summary_mismatch/
    );
  }

  // 11. Missing registry provenance cannot be promoted to verified physical truth.
  {
    const weakBase=clone(authorizationBase);
    weakBase.registry_digest="not-a-digest";
    const weakAuthorization={
      ...weakBase,
      receipt_sha256:digestObject(weakBase)
    };
    const {before,after}=runtimes();
    const receipt=buildExecutionReceipt({
      contextual_state:contextualState,
      request,
      proposal,
      authorization:weakAuthorization,
      authorized_actions:[action],
      physical_receipts:[verifiedPhysicalReceipt()],
      before_runtime:before,
      after_runtime:after,
      status:"EXECUTED",
      physical_committed:true
    });
    assert.equal(receipt.result,"APPLIED_UNVERIFIED");
    assert.equal(receipt.verification.authorization_registry_digest_verified,false);
    assert.equal(receipt.verification.physical_truth_verified,false);
    const verified=verifyExecutionReceipt(receipt);
    assert.equal(verified.valid,true);
    assert.equal(verified.physical_truth_verified,false);
  }

  // 12. Verified registry binding requires the source runtime artifact.
  {
    const receipt=buildVerified();
    assert.throws(
      ()=>verifyExecutionReceipt(receipt),
      /execution_receipt_before_runtime_required_for_registry_verification/
    );
  }

  // 13. An independently supplied source artifact must match the receipt digest binding.
  {
    const receipt=buildVerified();
    const forgedRequest=clone(request);
    forgedRequest.task_id="task-forged";
    assert.throws(
      ()=>verifyWithRuntime(receipt,{request:forgedRequest}),
      /execution_receipt_request_mismatch/
    );
  }

  // 14. Derived provenance fields cannot be rewritten independently of source artifacts.
  {
    const {before,after}=runtimes();

    let forged=buildVerified();
    forged.task_id="task-forged";
    forged=reseal(forged);
    assert.throws(
      ()=>verifyExecutionReceipt(forged,{
        contextual_state:contextualState,
        request,
        proposal,
        before_runtime:before,
        after_runtime:after
      }),
      /execution_receipt_task_id_mismatch/
    );

    forged=buildVerified();
    forged.proposal_id="proposal-forged";
    forged=reseal(forged);
    assert.throws(
      ()=>verifyExecutionReceipt(forged,{
        contextual_state:contextualState,
        request,
        proposal,
        before_runtime:before,
        after_runtime:after
      }),
      /execution_receipt_proposal_id_mismatch/
    );

    forged=buildVerified();
    forged.logical_targets=[OTHER];
    forged=reseal(forged);
    assert.throws(
      ()=>verifyExecutionReceipt(forged,{
        contextual_state:contextualState,
        request,
        proposal,
        before_runtime:before,
        after_runtime:after
      }),
      /execution_receipt_logical_targets_mismatch/
    );

    forged=buildVerified();
    forged.context_revision=999;
    forged=reseal(forged);
    assert.throws(
      ()=>verifyExecutionReceipt(forged,{
        contextual_state:contextualState,
        request,
        proposal,
        before_runtime:before,
        after_runtime:after
      }),
      /execution_receipt_context_revision_mismatch/
    );

    forged=buildVerified();
    forged.world_revision.before=99;
    forged=reseal(forged);
    assert.throws(
      ()=>verifyExecutionReceipt(forged,{
        contextual_state:contextualState,
        request,
        proposal,
        before_runtime:before,
        after_runtime:after
      }),
      /execution_receipt_world_revision_before_mismatch/
    );

    forged=buildVerified();
    forged.world_revision.after=99;
    forged=reseal(forged);
    assert.throws(
      ()=>verifyExecutionReceipt(forged,{
        contextual_state:contextualState,
        request,
        proposal,
        before_runtime:before,
        after_runtime:after
      }),
      /execution_receipt_world_revision_after_mismatch/
    );
  }

  // 15. Authorization provenance is part of verified physical truth.
  {
    const {before,after}=runtimes();
    const badBase={
      ...authorizationBase,
      case_id:"other-task"
    };
    const badAuthorization={
      ...badBase,
      receipt_sha256:digestObject(badBase)
    };
    const receipt=buildExecutionReceipt({
      contextual_state:contextualState,
      request,
      proposal,
      authorization:badAuthorization,
      authorized_actions:[action],
      physical_receipts:[verifiedPhysicalReceipt()],
      before_runtime:before,
      after_runtime:after,
      status:"EXECUTED",
      physical_committed:true,
      source_step:3,
      source_revision:8
    });
    assert.equal(receipt.verification.authorization_case_id_verified,false);
    assert.equal(receipt.verification.physical_truth_verified,false);
    assert.equal(receipt.result,"APPLIED_UNVERIFIED");
  }

  // 16. A post-hoc criterion mutation cannot survive independent verification.
  {
    let forged=buildVerified();
    forged.physical.evidence[0].completion_criterion.tolerance_pct=99;
    forged=refreshEvidenceDigest(forged);
    assert.throws(
      ()=>verifyWithRuntime(forged),
      /execution_receipt_physical_checks_mismatch/
    );
  }

  // 17. Valid physical truth does not become policy-bound physical completion
  //     when the observed criterion was not the one sealed at authorization time.
  {
    const {before,after}=runtimes();
    const physical=verifiedPhysicalReceipt();
    const differentCriterion={
      ...clone(completionCriterion),
      tolerance_pct:2
    };
    physical.completion_criterion=differentCriterion;
    physical.completion_criterion_sha256=digestObject(differentCriterion);
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
      physical_committed:true,
      source_step:3,
      source_revision:8
    });
    assert.equal(receipt.verification.physical_truth_verified,true);
    assert.equal(
      receipt.verification.completion_criterion_authorization_binding_verified,
      false
    );
    assert.equal(receipt.verification.physical_completion_verified,false);
    assert.equal(receipt.verification.independent_object_outcome_verified,false);
    const verified=verifyExecutionReceipt(receipt,{
      before_runtime:before,
      after_runtime:after
    });
    assert.equal(verified.physical_truth_verified,true);
    assert.equal(verified.physical_completion_verified,false);
    assert.equal(verified.independent_object_outcome_verified,false);
  }

  console.log(JSON.stringify({
    ok:true,
    cases:17,
    schema:"execution-receipt.v1",
    contract:"physical truth remains backward-compatible; stronger physical completion additionally requires an authorization-time criterion and identified witness"
  }));
})();
