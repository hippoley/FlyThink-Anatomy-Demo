"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawnSync}=require("child_process");
const {
  digestObject,
  buildExecutionReceipt
}=require("../scripts/execution_receipt.cjs");
const {
  digestDecisionProposal,
  decisionProposalToExecutionContracts
}=require("../scripts/decision_proposal_contract.cjs");
const {
  buildExecutionProofBundle,
  verifyExecutionProofBundle
}=require("../scripts/execution_proof_bundle.cjs");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");
const {
  CONTEXT_CANONICALIZATION,
  contextStateDigest
}=require("../scripts/contextual_edge_slu_adapter.cjs");

const W={area:"客厅",entity:"窗",instance:"default"};
const contextualState={
  contract_version:"contextual-state.v1",
  context_revision:7,
  context_canonicalization:CONTEXT_CANONICALIZATION,
  conversation:{
    conversation_id:"conv-1",
    active_task_id:"task-1",
    pending_task_id:null,
    focused_target:W,
    referent_set:[W]
  },
  tasks:[],
  world:{devices:{
    "客厅::窗::default":{
      target:W,model_id:"CWDS-CA01",slots:{opening:0}
    }
  }},
  execution:{device_health:{},pending_ids:[],last_execution:null}
};
contextualState.context_sha256=contextStateDigest(contextualState);
const decisionProposal={
  schema_version:"decision-proposal.v1",
  proposal_id:"proposal-1",
  task_id:"task-1",
  context_revision:7,
  context_sha256:contextualState.context_sha256,
  world_snapshot_revision:12,
  world_snapshot_sha256:"b".repeat(64),
  intent:"bounded_window_open",
  logical_targets:[W],
  proposed_mutations:[{
    target:W,property:"opening",operator:"SET",value:5
  }],
  confidence:0.95,
  requires_confirmation:false,
  evidence_refs:["sensor:co2"]
};

const adapted=decisionProposalToExecutionContracts(
  contextualState,
  decisionProposal
);
const request=adapted.request;
const internalProposal=adapted.internal_proposal;
const action=internalProposal.proposed_actions[0];

function clone(v){return JSON.parse(JSON.stringify(v))}
function resealBundle(bundle){
  const next=clone(bundle);
  delete next.bundle_sha256;
  next.bundle_sha256=digestObject(next);
  return next;
}
function runtimes(){
  const before=normalizeRuntime({devices:{
    "客厅::窗::default":{
      key:"客厅::窗::default",
      area:"客厅",entity:"窗",instance:"default",
      model_id:"CWDS-CA01",slots:{opening:0}
    }
  }});
  const after=normalizeRuntime({devices:{
    "客厅::窗::default":{
      key:"客厅::窗::default",
      area:"客厅",entity:"窗",instance:"default",
      model_id:"CWDS-CA01",slots:{opening:5}
    }
  }});
  after.revisions.push({op:"PATCH_SLOT",turn_id:"task-1"});
  return {before,after};
}
function authorization(before){
  const base={
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
    authorized_patches:[action]
  };
  base.authorization_id=digestObject({
    case_id:base.case_id,
    source_step:base.source_step,
    source_revision:base.source_revision,
    patch_digest:base.patch_digest,
    registry_digest:base.registry_digest,
    spatialruntime_commit_sha:base.spatialruntime_commit_sha,
    trace_hash:base.trace_hash
  });
  return {...base,receipt_sha256:digestObject(base)};
}
function physicalReceipt(){
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
function buildBundle(){
  const {before,after}=runtimes();
  const receipt=buildExecutionReceipt({
    contextual_state:contextualState,
    request,
    proposal:internalProposal,
    authorization:authorization(before),
    authorized_actions:[action],
    physical_receipts:[physicalReceipt()],
    before_runtime:before,
    after_runtime:after,
    status:"EXECUTED",
    physical_committed:true,
    atomic_batch:false,
    source_step:3,
    source_revision:8
  });
  return buildExecutionProofBundle({
    decision_proposal:decisionProposal,
    contextual_state:contextualState,
    request,
    internal_proposal:internalProposal,
    before_runtime:before,
    after_runtime:after,
    execution_receipt:receipt
  });
}

(()=>{
  const bundle=buildBundle();
  const verified=verifyExecutionProofBundle(bundle);

  {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-proof-"));
    const file=path.join(dir,"bundle.json");
    fs.writeFileSync(file,JSON.stringify(bundle,null,2)+"\n");
    const cli=spawnSync(
      process.execPath,
      [
        path.join(__dirname,"..","scripts","verify_execution_proof_bundle_cli.cjs"),
        file
      ],
      {encoding:"utf8"}
    );
    assert.equal(cli.status,0);
    const row=JSON.parse(cli.stdout.trim());
    assert.equal(row.verdict,"VERIFIED");
    assert.equal(row.bundle_sha256,bundle.bundle_sha256);
  }
  assert.equal(verified.valid,true);
  assert.equal(verified.physical_committed,true);
  assert.equal(verified.physical_truth_verified,true);
  assert.equal(verified.physical_completion_verified,false);
  assert.equal(verified.safe_closeout_verified,false);
  assert.equal(
    verified.decision_proposal_sha256,
    digestDecisionProposal(decisionProposal)
  );

  {
    let forged=buildBundle();
    forged.artifacts.decision_proposal.proposed_mutations[0].value=9;
    forged.manifest.decision_proposal_sha256=
      digestObject(forged.artifacts.decision_proposal);
    forged=resealBundle(forged);
    assert.throws(
      ()=>verifyExecutionProofBundle(forged),
      /execution_proof_bundle_decision_proposal_binding_mismatch/
    );
  }

  {
    let forged=buildBundle();
    forged.artifacts.contextual_state.conversation.conversation_id="substituted";
    forged.manifest.contextual_state_sha256=
      digestObject(forged.artifacts.contextual_state);
    forged=resealBundle(forged);
    assert.throws(
      ()=>verifyExecutionProofBundle(forged),
      /context_state_sha256_mismatch/
    );
  }

  {
    let forged=buildBundle();
    forged.artifacts.execution_receipt.result="APPLIED_UNVERIFIED";
    forged.manifest.execution_receipt_sha256=
      digestObject(forged.artifacts.execution_receipt);
    forged=resealBundle(forged);
    assert.throws(
      ()=>verifyExecutionProofBundle(forged),
      /execution_receipt_digest_mismatch/
    );
  }

  {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-proof-invalid-"));
    const file=path.join(dir,"bundle.json");
    const forged=clone(buildBundle());
    forged.artifacts.contextual_state.conversation.conversation_id="tampered";
    fs.writeFileSync(file,JSON.stringify(forged,null,2)+"\n");
    const cli=spawnSync(
      process.execPath,
      [
        path.join(__dirname,"..","scripts","verify_execution_proof_bundle_cli.cjs"),
        file
      ],
      {encoding:"utf8"}
    );
    assert.equal(cli.status,1);
    const row=JSON.parse(cli.stdout.trim());
    assert.equal(row.verdict,"INVALID");
  }

  {
    let legacy=buildBundle();
    delete legacy.verification.execution.physical_completion_verified;
    delete legacy.verification.execution.safe_closeout_verified;
    legacy=resealBundle(legacy);
    const checked=verifyExecutionProofBundle(legacy);
    assert.equal(checked.valid,true);
    assert.equal(checked.physical_truth_verified,true);
    assert.equal(checked.physical_completion_verified,false);
    assert.equal(checked.safe_closeout_verified,false);
  }

  {
    let forged=buildBundle();
    forged.verification.execution.physical_truth_verified=false;
    forged=resealBundle(forged);
    assert.throws(
      ()=>verifyExecutionProofBundle(forged),
      /execution_proof_bundle_verification_mismatch/
    );
  }

  console.log(JSON.stringify({
    ok:true,
    contract:"execution-proof-bundle.v1 binds decision-proposal.v1 to canonical execution-receipt.v1 without creating a second execution-truth authority"
  }));
})();
