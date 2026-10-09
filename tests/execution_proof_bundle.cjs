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
const {MockThingDriver}=require("../scripts/physical_runtime.cjs");
const {
  RECEIPT_SCHEMA,
  runtimeRegistryDigest,
  sha256Object:authorizationSha256Object
}=require("../scripts/spatialruntime_authorizer.cjs");
const {
  deriveProofUndoPlan,
  runProofDerivedUndo
}=require("../scripts/proof_derived_undo.cjs");
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

(async()=>{
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

  {
    const source=buildBundle();
    const current=normalizeRuntime(source.artifacts.after_runtime);
    current.executionLedger.push({
      id:"windowpilot:1",
      kind:"physical",
      status:"applied",
      semantic_patch:clone(action),
      physical_patch:clone(action),
      observation:clone(source.artifacts.execution_receipt.physical.evidence[0].observation)
    });

    const plan=deriveProofUndoPlan(source,current);
    assert.equal(plan.execution_id,"windowpilot:1");
    assert.equal(plan.compensation.op,"PATCH_SLOT");
    assert.equal(plan.compensation.slot,"opening");
    assert.equal(plan.compensation.value,0);
    assert.equal(plan.expected_current_value,5);
    assert.equal(plan.proof_basis.bundle_sha256,source.bundle_sha256);

    const seen=new Set();
    const ledger={
      add(id){
        if(seen.has(id))return false;
        seen.add(id);
        return true;
      }
    };
    let authCalls=0;
    const authorizer=async({
      patches,runtime,event,source_step,source_revision
    })=>{
      authCalls++;
      const registryDigest=runtimeRegistryDigest(runtime);
      const authorized=clone(patches);
      const base={
        schema:RECEIPT_SCHEMA,
        canonicalization:"sorted-json-number-normalized-v1",
        allow:true,
        case_id:String(event.turn_id),
        source_step:Number(source_step||0),
        source_revision:Number(source_revision||0),
        spatialruntime_commit_sha:null,
        requested_patch_count:authorized.length,
        authorized_patches:authorized,
        patch_digest:authorizationSha256Object(authorized),
        registry_digest:registryDigest,
        authorization_id:null,
        single_use:true,
        blocked:[],
        rain:"dry",
        exterior_window_keys:[],
        scene_evidence:null,
        trace_status:"completed",
        trace_hash:"a".repeat(64),
        safety_graph_fingerprint:"b".repeat(64),
        safety_forced_entities:[],
        commit_summary:{ready_to_dispatch:true}
      };
      base.authorization_id=authorizationSha256Object({
        case_id:base.case_id,
        source_step:base.source_step,
        source_revision:base.source_revision,
        patch_digest:base.patch_digest,
        registry_digest:base.registry_digest,
        spatialruntime_commit_sha:base.spatialruntime_commit_sha,
        trace_hash:base.trace_hash
      });
      return {
        allow:true,
        patches:authorized,
        receipt:{...base,receipt_sha256:authorizationSha256Object(base)}
      };
    };

    const driver=new MockThingDriver(current);
    const undone=await runProofDerivedUndo({
      runtime:current,
      proof_bundle:source,
      driver,
      physicalAuthorizer:authorizer,
      authorizationLedger:ledger
    });
    assert.equal(undone.ok,true);
    assert.equal(undone.status,"COMPENSATED");
    assert.equal(authCalls,1);
    assert.equal(driver.commands.length,1);
    assert.equal(driver.commands[0].patch.op,"PATCH_SLOT");
    assert.equal(driver.commands[0].patch.value,0);
    assert.equal(
      undone.runtime.devices["客厅::窗::default"].slots.opening,
      0
    );
    const marker=undone.runtime.executionLedger.find(
      item=>item.kind==="compensation"&&item.compensates==="windowpilot:1"
    );
    assert.ok(marker);
    assert.equal(marker.proof_basis.bundle_sha256,source.bundle_sha256);
    assert.equal(marker.authorization_id,undone.authorization.authorization_id);

    const diverged=normalizeRuntime(current);
    diverged.devices["客厅::窗::default"].slots.opening=3;
    assert.throws(
      ()=>deriveProofUndoPlan(source,diverged),
      /undo_current_state_diverged/
    );

    let mutatedCalls=0;
    const mutatedAuthorizer=async(args)=>{
      mutatedCalls++;
      const out=await authorizer(args);
      out.patches[0].value=1;
      out.receipt.authorized_patches[0].value=1;
      out.receipt.patch_digest=authorizationSha256Object(out.receipt.authorized_patches);
      const base=clone(out.receipt);
      delete base.receipt_sha256;
      out.receipt.receipt_sha256=authorizationSha256Object(base);
      return out;
    };
    await assert.rejects(
      ()=>runProofDerivedUndo({
        runtime:current,
        proof_bundle:source,
        driver:new MockThingDriver(current),
        physicalAuthorizer:mutatedAuthorizer,
        authorizationLedger:{add(){return true}}
      }),
      /undo_authorization_changed_derived_compensation|patch_digest_mismatch/
    );
    assert.equal(mutatedCalls,1);
  }

  console.log(JSON.stringify({
    ok:true,
    contract:"execution-proof-bundle.v1 binds execution truth and can drive exact proof-derived reauthorization without claim or compensation invention"
  }));
})().catch(err=>{console.error(err);process.exit(1)});
