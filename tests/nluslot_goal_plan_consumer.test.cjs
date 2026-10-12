"use strict";

const assert=require("node:assert/strict");
const test=require("node:test");
const {
  consumeCommittedGoal,
  validateNluslotGoalPlanSnapshot
}=require("../scripts/nluslot_goal_plan_consumer.cjs");
const {
  validateExecutionRequest,
  validateExecutionProposal
}=require("../scripts/execution_reasoning_contract.cjs");

function snapshot(status="SEMANTIC_COMMITTED_NOT_EXECUTED"){
  return {
    contract_version:"goal-plan-control.v1",
    context_revision:7,
    registry_schema_sha256:"a".repeat(64),
    conversation_id:"nluslot-consumer-proof",
    goals:[{
      goal_id:"g1",
      goal:"客厅通风",
      context_revision:7,
      task_id:"task:g1",
      plan:{
        revision:3,
        actions:[
          {
            target:{area:"客厅",entity:"新风",instance:"default"},
            thing_model:"ventilation",
            property:"speed",
            value:2
          },
          {
            target:{area:"客厅",entity:"窗",instance:"default"},
            thing_model:"window",
            property:"position",
            value:15
          }
        ]
      },
      execution:{
        status,
        request_id:null,
        gateway_status:null,
        physically_verified:false
      }
    }],
    clarifications:[],
    authority:{
      semantic_commit:"trusted_runtime_only",
      physical_execution:"trusted_gateway_only",
      external_view:"read_only"
    }
  };
}

test("consumes committed NLUSLOT plan into existing FlyThink contracts",()=>{
  const source=snapshot();
  assert.equal(validateNluslotGoalPlanSnapshot(source),true);
  const out=consumeCommittedGoal(source,"g1");
  assert.equal(out.consumed,true);
  assert.equal(out.source_contract,"goal-plan-control.v1");
  assert.equal(out.request.candidate_actions.length,2);
  assert.equal(out.proposal.decision,"PROPOSE");
  assert.equal(validateExecutionRequest(out.request),true);
  assert.equal(validateExecutionProposal(out.proposal,out.request),true);
  assert.equal(out.request.candidate_actions[0].target.instance,"default");
});

test("does not turn an unconfirmed NLUSLOT plan into execution",()=>{
  const out=consumeCommittedGoal(snapshot("AWAITING_CONFIRMATION"),"g1");
  assert.equal(out.consumed,false);
  assert.equal(out.decision,"DEFER");
});

test("rejects physical-id shaped target instead of weakening FlyThink target contract",()=>{
  const source=snapshot();
  source.goals[0].plan.actions[0].target={
    area:"客厅",entity:"新风",instance:"default",entity_id:"air-123"
  };
  assert.throws(
    ()=>validateNluslotGoalPlanSnapshot(source),
    /nluslot_goal_target_invalid/
  );
});
