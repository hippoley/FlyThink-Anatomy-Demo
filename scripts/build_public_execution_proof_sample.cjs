"use strict";

const fs=require("fs");
const path=require("path");
const {
  digestObject,
  buildExecutionReceipt
}=require("./execution_receipt.cjs");
const {
  decisionProposalToExecutionContracts
}=require("./decision_proposal_contract.cjs");
const {
  buildExecutionProofBundle,
  verifyExecutionProofBundle
}=require("./execution_proof_bundle.cjs");
const {normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {
  CONTEXT_CANONICALIZATION,
  contextStateDigest
}=require("./contextual_edge_slu_adapter.cjs");

const TARGET={area:"客厅",entity:"窗",instance:"default"};
const ACTION={op:"PATCH_SLOT",target:TARGET,slot:"opening",value:5};

function clone(v){return JSON.parse(JSON.stringify(v));}

function buildSample(){
  const contextualState={
    contract_version:"contextual-state.v1",
    context_revision:7,
    context_canonicalization:CONTEXT_CANONICALIZATION,
    conversation:{
      conversation_id:"sample-conversation",
      active_task_id:"sample-task",
      pending_task_id:null,
      focused_target:TARGET,
      referent_set:[TARGET]
    },
    tasks:[],
    world:{devices:{
      "客厅::窗::default":{
        target:TARGET,model_id:"CWDS-CA01",slots:{opening:0}
      }
    }},
    execution:{device_health:{},pending_ids:[],last_execution:null}
  };
  contextualState.context_sha256=contextStateDigest(contextualState);

  const decisionProposal={
    schema_version:"decision-proposal.v1",
    proposal_id:"sample-proposal",
    task_id:"sample-task",
    context_revision:7,
    context_sha256:contextualState.context_sha256,
    world_snapshot_revision:12,
    world_snapshot_sha256:"b".repeat(64),
    intent:"bounded_window_open",
    logical_targets:[TARGET],
    proposed_mutations:[{
      target:TARGET,property:"opening",operator:"SET",value:5
    }],
    confidence:0.95,
    requires_confirmation:false,
    evidence_refs:["sample:sensor"]
  };

  const adapted=decisionProposalToExecutionContracts(
    contextualState,
    decisionProposal
  );
  const request=adapted.request;
  const proposal=adapted.internal_proposal;
  const action=proposal.proposed_actions[0];

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
  after.revisions.push({op:"PATCH_SLOT",turn_id:"sample-task"});

  const criterion={
    version:"windowpilot-completion-criterion.v1",
    target:TARGET,
    slot:"opening",
    predicate:"abs(observed_position_pct-requested_position_pct)<=tolerance_pct",
    requested_position_pct:5,
    tolerance_pct:1,
    require_fresh_readback:true,
    witness_source:"windowpilot:/api/state",
    witness_method:"windowpilot-state-readback",
    expected_hardware_identity_sha256:"sample-hw"
  };
  const criterionSha=digestObject(criterion);
  const completionCriteria=[{
    criterion,
    criterion_sha256:criterionSha
  }];

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
    case_id:"sample-task",
    source_step:3,
    source_revision:12,
    authorized_patches:[action],
    completion_criteria:completionCriteria,
    completion_criteria_sha256:digestObject(completionCriteria)
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

  const physicalReceipt={
    patch:clone(action),
    physical_patch:clone(action),
    command_id:"sample-windowpilot-command",
    status:"applied",
    reason:null,
    observation:{
      target:clone(TARGET),
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
    ack:{ok:true,command_id:"sample-ack"},
    before_tick:10,
    requested_position_pct:5,
    hardware_identity_before:"sample-hw",
    hardware_identity_after:"sample-hw",
    readiness_before:{physical_write_ready:true},
    readiness_after:{physical_write_ready:true},
    completion_criterion:clone(criterion),
    completion_criterion_sha256:criterionSha,
    witness:{
      witness_id:"windowpilot-state:sample-hw",
      source:"windowpilot:/api/state",
      method:"windowpilot-state-readback",
      hardware_identity_sha256:"sample-hw"
    },
    criterion_fixed_at_ms:999,
    observation_window:{
      criterion_fixed_at_ms:999,
      ack_at_ms:1000,
      received_at_ms:1001
    },
    safety_stop:null
  };

  const receipt=buildExecutionReceipt({
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
    atomic_batch:false,
    source_step:3,
    source_revision:12
  });

  const bundle=buildExecutionProofBundle({
    decision_proposal:decisionProposal,
    contextual_state:contextualState,
    request,
    internal_proposal:proposal,
    before_runtime:before,
    after_runtime:after,
    execution_receipt:receipt
  });

  const verified=verifyExecutionProofBundle(bundle);
  if(
    verified.valid!==true||
    verified.physical_truth_verified!==true||
    verified.physical_completion_verified!==true
  ){
    throw new Error("public_sample_did_not_verify_strong_completion_claim");
  }
  return bundle;
}

function main(argv=process.argv.slice(2)){
  const out=path.resolve(
    argv[0]||"interop/execution-proof/sample-completion-proven.json"
  );
  const bundle=buildSample();
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(bundle,null,2)+"\n");
  process.stdout.write(JSON.stringify({
    ok:true,
    path:out,
    bundle_sha256:bundle.bundle_sha256,
    physical_truth_verified:true,
    physical_completion_verified:true
  })+"\n");
}

if(require.main===module)main();

module.exports={buildSample,main};
