"use strict";
const assert=require("assert");
const {
  CONTRACT_VERSION,
  CONTEXT_CANONICALIZATION,
  logicalTarget,
  deriveSemanticContext,
  toContextStateSnapshot,
  contextStateDigest,
  contextStateIdentity,
  assertContextStateSnapshot
}=require("../scripts/contextual_edge_slu_adapter.cjs");

function sealExternal(snapshot){
  const out=JSON.parse(JSON.stringify(snapshot));
  out.context_canonicalization=CONTEXT_CANONICALIZATION;
  out.context_sha256=contextStateDigest(out);
  return out;
}

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
assert.equal(Object.prototype.hasOwnProperty.call(snapshot,"context_sha256"),false);
assert.throws(
  ()=>contextStateIdentity(snapshot),
  /context_state_revision_required/
);

const localVersioned=toContextStateSnapshot(runtime,history,{
  conversation_id:"conv-1",
  context_revision:12
});
assert.throws(
  ()=>contextStateIdentity(localVersioned),
  /context_state_canonicalization_required/
);

const external=sealExternal(localVersioned);
assert.deepEqual(contextStateIdentity(external),{
  contract_version:CONTRACT_VERSION,
  context_revision:12,
  context_canonicalization:CONTEXT_CANONICALIZATION,
  context_sha256:external.context_sha256
});

const substituted=JSON.parse(JSON.stringify(external));
substituted.conversation.conversation_id="other-conversation";
assert.equal(substituted.context_revision,external.context_revision);
assert.throws(
  ()=>contextStateIdentity(substituted),
  /context_state_sha256_mismatch/
);

assert.throws(
  ()=>toContextStateSnapshot(runtime,history,{
    conversation_id:"conv-1",
    context_revision:-1
  }),
  /context_state_revision_invalid/
);

const golden={
  contract_version:CONTRACT_VERSION,
  context_revision:3,
  context_canonicalization:CONTEXT_CANONICALIZATION,
  conversation:{
    conversation_id:"中文",
    active_task_id:null,
    pending_task_id:null,
    focused_target:null,
    referent_set:[]
  },
  tasks:[],
  world:{devices:{
    "客厅::窗::default":{
      target:{area:"客厅",entity:"窗",instance:"default"},
      model_id:"CWDS-CA01",
      slots:{opening:1.0}
    }
  }},
  execution:{device_health:{},pending_ids:[],last_execution:null}
};
assert.equal(
  contextStateDigest(golden),
  "20aa0b07994f9d3b18fcd7c5c3be84db8205eac733cf54f622bf138226d5609a"
);

const nonFinite=JSON.parse(JSON.stringify(golden));
nonFinite.world.devices["客厅::窗::default"].slots.opening=Infinity;
assert.throws(
  ()=>contextStateDigest(nonFinite),
  /context_state_non_finite_number/
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
  golden_context_sha256:contextStateDigest(golden),
  contract:"FlyThink verifies externally minted contextual-state.v1 revision + digest and cannot mint semantic identity"
}));
