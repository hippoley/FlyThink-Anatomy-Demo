"use strict";
const assert=require("assert");
const {normalizeRuntime,applyTurn}=require("./whole_home_patch_contract.cjs");
const {atomicApplyAuthorizedTurn}=require("./atomic_authorized_commit.cjs");
const AC_L={area:"客厅",entity:"空调"},AC_B={area:"主卧",entity:"空调"},LIGHT={area:"客厅",entity:"灯"};
let r=normalizeRuntime();
r=applyTurn(r,[
 {op:"ADD_DEVICE",target:AC_L,slots:{power:"ON",temperature:24}},
 {op:"ADD_DEVICE",target:AC_B,slots:{power:"ON",temperature:25}},
 {op:"ADD_DEVICE",target:LIGHT,slots:{power:"OFF"}}
]).runtime;
// Valid SET commits both and touches nothing else.
let out=atomicApplyAuthorizedTurn(r,[
 {op:"PATCH_SLOT",target:AC_L,slot:"temperature",value:22},
 {op:"PATCH_SLOT",target:AC_B,slot:"temperature",value:22}
],["客厅::空调::default","主卧::空调::default"]);
assert(out.ok);assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,22);
assert.equal(out.runtime.devices["客厅::灯::default"].slots.power,"OFF");
// Protected second target makes entire turn rollback: partial SET commit = 0.
let protectedR=applyTurn(r,[{op:"PROTECT",target:AC_B,slot:"temperature"}]).runtime;
out=atomicApplyAuthorizedTurn(protectedR,[
 {op:"PATCH_SLOT",target:AC_L,slot:"temperature",value:21},
 {op:"PATCH_SLOT",target:AC_B,slot:"temperature",value:21}
],["客厅::空调::default","主卧::空调::default"]);
assert(!out.ok);assert.deepStrictEqual(out.runtime,protectedR);assert.equal(out.receipts.length,0);
// Wrong/unmounted target cannot create a device through this authorized boundary.
out=atomicApplyAuthorizedTurn(r,[{op:"PATCH_SLOT",target:{area:"书房",entity:"空调"},slot:"temperature",value:22}]);
assert(!out.ok);assert(out.reason.startsWith("target_not_authorized:"));assert.deepStrictEqual(out.runtime,r);
console.log(JSON.stringify({atomic_valid_set:true,partial_set_commit:0,wrong_device_execution:0,untouched_state_violation:0,commit_allowlist_enforced:true}));
