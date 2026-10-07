"use strict";

const assert=require("assert");
const fs=require("fs");
const path=require("path");

const {
  validateDecisionProposal,
  digestDecisionProposal,
  decisionProposalToExecutionContracts
}=require("../scripts/decision_proposal_contract.cjs");
const {
  runDecisionProposal
}=require("../scripts/flythink_execution_runtime.cjs");
const {normalizeRuntime}=require("../scripts/whole_home_patch_contract.cjs");
const {toContextStateSnapshot}=require("../scripts/contextual_edge_slu_adapter.cjs");

const TARGET={area:"卧室",entity:"窗",instance:"east"};
const WORLD_SHA="a".repeat(64);

function context(){
  const runtime=normalizeRuntime({devices:{
    "卧室::窗::east":{
      key:"卧室::窗::east",
      area:"卧室",
      entity:"窗",
      instance:"east",
      slots:{opening:0}
    }
  }});
  const snapshot=toContextStateSnapshot(runtime,[],{
    conversation_id:"conv-1",
    active_task_id:"task-1"
  });
  snapshot.context_revision=7;
  return {runtime,snapshot};
}

function proposal(overrides={}){
  return {
    schema_version:"decision-proposal.v1",
    proposal_id:"proposal-1",
    task_id:"task-1",
    context_revision:7,
    world_snapshot_revision:0,
    world_snapshot_sha256:WORLD_SHA,
    intent:"VENTILATE",
    logical_targets:[TARGET],
    proposed_mutations:[{
      target:TARGET,
      property:"opening",
      operator:"SET",
      value:5
    }],
    reason:"high_co2",
    confidence:0.84,
    requires_confirmation:false,
    evidence_refs:["sensor:co2:bedroom"],
    ...overrides
  };
}

(async()=>{
  // 1. Published schema exists and freezes the public contract version.
  {
    const schema=JSON.parse(fs.readFileSync(
      path.join(__dirname,"..","contracts","decision-proposal.v1.schema.json"),
      "utf8"
    ));
    assert.equal(schema.properties.schema_version.const,"decision-proposal.v1");
    assert.equal(schema.additionalProperties,false);
    assert.ok(schema.required.includes("world_snapshot_sha256"));
    assert.equal(schema.properties.world_snapshot_sha256.pattern,"^[0-9a-f]{64}$");
    assert.deepEqual(schema.$defs.mutation.properties.operator.enum,["SET","ADD"]);
  }

  // 2. Valid external proposal adapts into internal execution contracts.
  {
    const {snapshot}=context();
    const external=proposal();
    validateDecisionProposal(external);
    const adapted=decisionProposalToExecutionContracts(snapshot,external);
    assert.equal(adapted.external_contract,"decision-proposal.v1");
    assert.equal(adapted.request.request_version,"flythink-execution-request.v1");
    assert.equal(adapted.internal_proposal.schema_version,"flythink-execution-proposal.v1");
    assert.equal(adapted.internal_proposal.proposal_id,"proposal-1");
    assert.equal(adapted.internal_proposal.decision,"PROPOSE");
    assert.deepEqual(adapted.internal_proposal.proposed_actions,[{
      op:"PATCH_SLOT",
      target:TARGET,
      slot:"opening",
      value:5
    }]);
    assert.equal(
      adapted.internal_proposal.strategy.source_decision_proposal_sha256,
      digestDecisionProposal(external)
    );
    assert.equal(adapted.world_snapshot_sha256,WORLD_SHA);
    assert.equal(adapted.internal_proposal.strategy.world_snapshot_sha256,WORLD_SHA);
  }

  // 3. Raw/physical identity is forbidden at the public proposal boundary.
  {
    const leaked=proposal({
      physical_target:{
        device_id:"window_002",
        hardware_uuid:"hw-secret"
      }
    });
    assert.throws(
      ()=>validateDecisionProposal(leaked),
      /decision_proposal_forbidden_field/
    );
  }

  // 4. Every mutation target must be explicitly declared.
  {
    const other={area:"客厅",entity:"窗",instance:"east"};
    const bad=proposal({
      proposed_mutations:[{
        target:other,
        property:"opening",
        operator:"SET",
        value:5
      }]
    });
    assert.throws(
      ()=>validateDecisionProposal(bad),
      /mutation_target_not_declared/
    );
  }

  // 5. Context revision drift is rejected before execution adaptation.
  {
    const {snapshot}=context();
    assert.throws(
      ()=>decisionProposalToExecutionContracts(
        snapshot,
        proposal({context_revision:8})
      ),
      /context_revision_mismatch/
    );
  }

  // 6. Explicit confirmation requirement becomes DEFER with zero actions.
  {
    const {snapshot}=context();
    const adapted=decisionProposalToExecutionContracts(
      snapshot,
      proposal({requires_confirmation:true})
    );
    assert.equal(adapted.internal_proposal.decision,"DEFER");
    assert.deepEqual(adapted.internal_proposal.proposed_actions,[]);
  }

  // 7. World revision drift blocks before authorizer/driver.
  {
    const {runtime,snapshot}=context();
    let authorizerCalls=0;
    let driverCalls=0;
    const out=await runDecisionProposal({
      runtime,
      contextual_state:snapshot,
      decision_proposal:proposal({world_snapshot_revision:0}),
      world_snapshot_revision:1,
      world_snapshot_sha256:WORLD_SHA,
      physicalAuthorizer:async()=>{authorizerCalls++;throw new Error("must not run")},
      driver:{execute:async()=>{driverCalls++;throw new Error("must not run")}}
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"BLOCKED");
    assert.equal(out.reason,"decision_proposal_world_revision_mismatch");
    assert.equal(out.expected_world_snapshot_revision,1);
    assert.equal(authorizerCalls,0);
    assert.equal(driverCalls,0);
    assert.equal(out.receipt.proposal_id,"proposal-1");
  }

  // 8. Missing authoritative SpatialRuntime revision blocks before authorization.
  {
    const {runtime,snapshot}=context();
    let authorizerCalls=0;
    let driverCalls=0;
    const out=await runDecisionProposal({
      runtime,
      contextual_state:snapshot,
      decision_proposal:proposal(),
      physicalAuthorizer:async()=>{authorizerCalls++;throw new Error("must not run")},
      driver:{execute:async()=>{driverCalls++;throw new Error("must not run")}}
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"BLOCKED");
    assert.equal(out.reason,"spatialruntime_world_revision_required");
    assert.equal(authorizerCalls,0);
    assert.equal(driverCalls,0);
  }

  // 9. Confirmation-required proposal never reaches authorizer/driver.
  {
    const {runtime,snapshot}=context();
    let authorizerCalls=0;
    let driverCalls=0;
    const out=await runDecisionProposal({
      runtime,
      contextual_state:snapshot,
      decision_proposal:proposal({requires_confirmation:true}),
      world_snapshot_revision:0,
      world_snapshot_sha256:WORLD_SHA,
      physicalAuthorizer:async()=>{authorizerCalls++;throw new Error("must not run")},
      driver:{execute:async()=>{driverCalls++;throw new Error("must not run")}}
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"DEFERRED");
    assert.equal(out.reason,"reasoner_deferred");
    assert.equal(authorizerCalls,0);
    assert.equal(driverCalls,0);
  }

  // 10. Missing authoritative WorldSnapshot identity blocks before authorization.
  {
    const {runtime,snapshot}=context();
    let authorizerCalls=0;
    let driverCalls=0;
    const out=await runDecisionProposal({
      runtime,
      contextual_state:snapshot,
      decision_proposal:proposal(),
      world_snapshot_revision:0,
      physicalAuthorizer:async()=>{authorizerCalls++;throw new Error("must not run")},
      driver:{execute:async()=>{driverCalls++;throw new Error("must not run")}}
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"BLOCKED");
    assert.equal(out.reason,"spatialruntime_world_snapshot_sha256_required");
    assert.equal(authorizerCalls,0);
    assert.equal(driverCalls,0);
  }

  // 11. Equal revision cannot substitute a different WorldSnapshot.
  {
    const {runtime,snapshot}=context();
    let authorizerCalls=0;
    let driverCalls=0;
    const out=await runDecisionProposal({
      runtime,
      contextual_state:snapshot,
      decision_proposal:proposal(),
      world_snapshot_revision:0,
      world_snapshot_sha256:"b".repeat(64),
      physicalAuthorizer:async()=>{authorizerCalls++;throw new Error("must not run")},
      driver:{execute:async()=>{driverCalls++;throw new Error("must not run")}}
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,"BLOCKED");
    assert.equal(out.reason,"decision_proposal_world_snapshot_sha256_mismatch");
    assert.equal(out.expected_world_snapshot_sha256,"b".repeat(64));
    assert.equal(out.supplied_world_snapshot_sha256,WORLD_SHA);
    assert.equal(authorizerCalls,0);
    assert.equal(driverCalls,0);
  }

  // 12. Malformed proposal WorldSnapshot identity is rejected at contract validation.
  {
    assert.throws(
      ()=>validateDecisionProposal(proposal({world_snapshot_sha256:"not-a-sha"})),
      /world_snapshot_sha256_invalid/
    );
  }

  // 13. Relative mutation must carry a finite numeric delta.
  {
    assert.throws(
      ()=>validateDecisionProposal(proposal({
        proposed_mutations:[{
          target:TARGET,
          property:"opening",
          operator:"ADD",
          value:"not-a-number"
        }]
      })),
      /relative_value_invalid/
    );
  }

  console.log(JSON.stringify({
    ok:true,
    cases:13,
    schema:"decision-proposal.v1",
    contract:"external reasoning proposal is untrusted, logical-target-only, context/world-identity-bound, and cannot directly reach physical execution"
  }));
})().catch(err=>{console.error(err);process.exit(1)});
