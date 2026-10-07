"use strict";
const assert=require("assert");
const {deriveContext}=require("../scripts/runtime_context_adapter.cjs");

const target={area:"客厅",entity:"窗",instance:"default"};
const runtime={
  devices:{
    "客厅::窗::default":{model_id:"CWDS-CA01",slots:{opening:12}}
  },
  pending:{},
  deviceHealth:{
    "客厅::窗::default":{
      status:"quarantined",
      reason:"safety_stop_not_confirmed",
      source_status:"unsafe",
      command_id:"cmd-2",
      since_turn_id:2
    }
  },
  protectedInvariants:{},
  executionLedger:[
    {id:"cmd-1",status:"applied",turn_id:1,semantic_patch:{op:"PATCH_SLOT",target,slot:"opening",value:20},observation:{target,slots:{opening:20}}},
    {id:"cmd-2",status:"timeout",reason:"position_not_observed_within_tolerance",turn_id:2,semantic_patch:{op:"PATCH_SLOT",target,slot:"opening",value:40},observation:{target,slots:{opening:12}}}
  ]
};
const history=[
  {outcome:"EXECUTE",committed:true,applied_patches:[{op:"PATCH_SLOT",target,slot:"opening",value:40}]}
];
const ctx=deriveContext(runtime,history);
assert.equal(ctx.focused_target.area,"客厅");
assert.deepEqual(ctx.executed_ids,["cmd-1"]);
assert.deepEqual(ctx.failed_execution_ids,["cmd-2"]);
assert.equal(ctx.last_execution.status,"timeout");
assert.equal(ctx.last_execution.observation.slots.opening,12);
assert.equal(ctx.quarantined_devices.length,1);
assert.equal(ctx.quarantined_devices[0].device_key,"客厅::窗::default");
assert.equal(ctx.quarantined_devices[0].reason,"safety_stop_not_confirmed");
assert.ok(ctx.quarantined_devices[0].allowed_actions.includes("CLOSE"));
assert.equal(
  ctx.device_write_policy["客厅::窗::default"].mode,
  "safety_recovery_only"
);
assert.ok(
  ctx.device_write_policy["客厅::窗::default"].allowed_actions.includes("RECOVERY")
);
console.log(JSON.stringify({
  ok:true,
  contract:"device feedback and persistent quarantine policy are available to next-turn semantic context"
}));
