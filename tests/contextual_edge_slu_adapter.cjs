"use strict";
const assert=require("assert");
const {
  CONTRACT_VERSION,
  logicalTarget,
  deriveSemanticContext,
  toContextStateSnapshot,
  contextStateIdentity,
  assertContextStateSnapshot
}=require("../scripts/contextual_edge_slu_adapter.cjs");

const target={area:"主卧",entity:"空调",instance:"default"};
const runtime={
  devices:{
    "主卧::空调::default":{
      area:"主卧",entity:"空调",instance:"default",
      model_id:"AWGD-ZA01",
      slots:{power:"ON",temperature:25}
    }
  },
  pending:{},
  protectedInvariants:{},
  executionLedger:[],
  deviceHealth:{
    "主卧::空调::default":{
      status:"quarantined",
      reason:"hardware_identity_changed_after_actuation",
      since_turn_id:"t7"
    }
  }
};
const history=[
  {outcome:"EXECUTE",committed:true,applied_patches:[
    {op:"PATCH_SLOT",target,slot:"temperature",value:25}
  ]}
];

assert.deepEqual(logicalTarget(target),target);
const context=deriveSemanticContext(runtime,history);
assert.deepEqual(context.focused_target,target);

const snapshot=toContextStateSnapshot(runtime,history,{conversation_id:"conv-1"});
assert.equal(Object.prototype.hasOwnProperty.call(snapshot,"context_revision"),false);
assert.throws(
  ()=>contextStateIdentity(snapshot),
  /context_state_revision_required/
);

const versionedSnapshot=toContextStateSnapshot(runtime,history,{
  conversation_id:"conv-1",
  context_revision:12
});
assert.deepEqual(contextStateIdentity(versionedSnapshot),{
  contract_version:CONTRACT_VERSION,
  context_revision:12
});
assert.throws(
  ()=>toContextStateSnapshot(runtime,history,{
    conversation_id:"conv-1",
    context_revision:-1
  }),
  /context_state_revision_invalid/
);
assert.equal(snapshot.contract_version,CONTRACT_VERSION);
assert.equal(snapshot.conversation.conversation_id,"conv-1");
assert.deepEqual(snapshot.conversation.focused_target,target);
assert.deepEqual(
  snapshot.world.devices["主卧::空调::default"].target,
  target
);
assert.equal(
  snapshot.execution.device_health["主卧::空调::default"].status,
  "quarantined"
);
assert.ok(
  snapshot.execution.device_health["主卧::空调::default"].allowed_actions.includes("POWER_OFF")
);
assert.equal(assertContextStateSnapshot(snapshot),true);
assert.equal("entity_id" in snapshot.world.devices["主卧::空调::default"].target,false);

console.log(JSON.stringify({
  ok:true,
  contract:"FlyThink may consume externally versioned contextual-state.v1 identity but does not mint context_revision"
}));
