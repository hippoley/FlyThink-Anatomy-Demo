"use strict";

const fs=require("fs");
const assert=require("assert");
const {
  CONTEXT_CANONICALIZATION,
  contextStateDigest
}=require("../scripts/contextual_edge_slu_adapter.cjs");
const {
  buildCanonicalDecisionProposal
}=require("../scripts/run_acoustic_windowpilot_e2e.cjs");
const {
  decisionProposalToExecutionContracts
}=require("../scripts/decision_proposal_contract.cjs");

function sealedContext(){
  const snapshot={
    contract_version:"contextual-state.v1",
    context_revision:12,
    context_canonicalization:CONTEXT_CANONICALIZATION,
    conversation:{
      conversation_id:"conv-live-1",
      active_task_id:"task-window-probe",
      pending_task_id:null,
      focused_target:{area:"主卧",entity:"窗",instance:"default"},
      referent_set:[{area:"主卧",entity:"窗",instance:"default"}]
    },
    tasks:[],
    world:{
      devices:{
        "主卧::窗::default":{
          target:{area:"主卧",entity:"窗",instance:"default"},
          model_id:"CWDS-CA01",
          slots:{opening:0,power:"OFF"},
          observed_at:null,
          source:"windowpilot"
        }
      }
    },
    execution:{device_health:{},pending_ids:[],last_execution:null}
  };
  snapshot.context_sha256=contextStateDigest(snapshot);
  return snapshot;
}

function finalHandoff(){
  return {
    turn_id:"turn-live-1",
    handoff_ready:true,
    semantic:{decision:"EXECUTE",confidence:0.98},
    target_resolution:{
      targets:[{area:"主卧",entity:"窗",instance:"default"}]
    },
    patch_proposal:[{
      op:"PATCH_SLOT",
      target:{area:"主卧",entity:"窗",instance:"default"},
      slot:"opening",
      value:5
    }]
  };
}

const world={
  world_snapshot_revision:7,
  world_snapshot_sha256:"a".repeat(64)
};

{
  const context=sealedContext();
  const proposal=buildCanonicalDecisionProposal(finalHandoff(),context,world);
  assert.equal(proposal.schema_version,"decision-proposal.v1");
  assert.equal(proposal.task_id,"task-window-probe");
  assert.equal(proposal.context_revision,12);
  assert.equal(proposal.context_sha256,context.context_sha256);
  assert.equal(proposal.world_snapshot_revision,7);
  assert.equal(proposal.world_snapshot_sha256,"a".repeat(64));
  assert.equal(proposal.proposed_mutations.length,1);
  assert.deepEqual(proposal.proposed_mutations[0],{
    target:{area:"主卧",entity:"窗",instance:"default"},
    property:"opening",
    operator:"SET",
    value:5
  });
  const contracts=decisionProposalToExecutionContracts(context,proposal);
  assert.equal(contracts.internal_proposal.strategy.source_contract,"decision-proposal.v1");
  assert.equal(contracts.internal_proposal.proposed_actions.length,1);
}

{
  const context=sealedContext();
  context.conversation.active_task_id=null;
  context.context_sha256=contextStateDigest(context);
  assert.throws(
    ()=>buildCanonicalDecisionProposal(finalHandoff(),context,world),
    /canonical_handoff_active_task_id_required/
  );
}

{
  const context=sealedContext();
  context.context_sha256="b".repeat(64);
  assert.throws(
    ()=>buildCanonicalDecisionProposal(finalHandoff(),context,world),
    /context_state_sha256_mismatch/
  );
}

{
  const row=finalHandoff();
  row.handoff_ready=false;
  assert.throws(
    ()=>buildCanonicalDecisionProposal(row,sealedContext(),world),
    /canonical_handoff_not_ready/
  );
}

const source=fs.readFileSync("scripts/run_acoustic_windowpilot_e2e.cjs","utf8");
for(const token of [
  "semanticOnly:apply",
  "canonical_live_apply_preboundary_physical_write_detected",
  "runDecisionProposal({",
  "buildExecutionProofBundle({",
  "verifyExecutionProofBundle(proofBundle)",
  "--apply requires --contextual-state",
  "--apply requires --authorization-ledger",
  "--apply requires --spatialruntime-authorize"
]){
  assert.ok(source.includes(token),"missing canonical live boundary token: "+token);
}
assert.ok(
  source.indexOf("canonical_live_apply_preboundary_physical_write_detected") <
  source.indexOf("runDecisionProposal({"),
  "zero-write assertion must execute before canonical runtime crossing"
);

console.log(JSON.stringify({
  ok:true,
  contract:"live APPLY may cross WindowPilot only after exact Context+World identity becomes a validated DecisionProposal"
}));
