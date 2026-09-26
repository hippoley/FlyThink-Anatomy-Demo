"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {applyPatch, applyTurn, assertUntouchedStatePreserved} = require("../scripts/whole_home_patch_contract.cjs");

const living = {area:"客厅",entity:"climate",instance:"ac-1"};
const bedroom = {area:"主卧",entity:"climate",instance:"ac-1"};
const window = {area:"客厅",entity:"window",instance:"w-1"};

function base(){
  return {
    devices:{
      "客厅::climate::ac-1":{key:"客厅::climate::ac-1",area:"客厅",entity:"climate",instance:"ac-1",status:"mounted",slots:{power:"ON",temperature:24,mode:"COOL"}},
      "客厅::window::w-1":{key:"客厅::window::w-1",area:"客厅",entity:"window",instance:"w-1",status:"mounted",slots:{opening:50}}
    },
    pending:{"p1":{status:"pending",target:living}},
    tasks:{"t1":{status:"active"}},
    executionLedger:[{id:"e1",patch:{op:"PATCH_SLOT",target:living,slot:"temperature",value:24}}]
  };
}

test("新增卧室空调保留客厅所有既有状态",()=>{
  const before=base();
  const {runtime}=applyPatch(before,{op:"ADD_DEVICE",target:bedroom,slots:{power:"ON"}});
  assert.deepEqual(runtime.devices["客厅::climate::ac-1"],before.devices["客厅::climate::ac-1"]);
  assert.deepEqual(runtime.devices["客厅::window::w-1"],before.devices["客厅::window::w-1"]);
  assert.equal(runtime.devices["主卧::climate::ac-1"].slots.power,"ON");
});

test("修改一个槽位不会重置同设备其他槽位或其他设备",()=>{
  const before=base();
  const {runtime}=applyPatch(before,{op:"PATCH_SLOT",target:living,slot:"temperature",value:22});
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.temperature,22);
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.power,"ON");
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.mode,"COOL");
  assert.deepEqual(runtime.devices["客厅::window::w-1"],before.devices["客厅::window::w-1"]);
});

test("关闭设备是状态修改，不是从全屋树移除",()=>{
  const {runtime}=applyPatch(base(),{op:"CLOSE_DEVICE",target:living});
  assert.ok(runtime.devices["客厅::climate::ac-1"]);
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.power,"OFF");
});

test("取消 pending 操作不删除设备持续状态",()=>{
  const before=base();
  const {runtime}=applyPatch(before,{op:"CANCEL_PENDING",pending_id:"p1"});
  assert.equal(runtime.pending.p1.status,"cancelled");
  assert.deepEqual(runtime.devices,before.devices);
});

test("REMOVE_DEVICE 与 CLOSE_DEVICE 语义不同",()=>{
  const closed=applyPatch(base(),{op:"CLOSE_DEVICE",target:living}).runtime;
  const removed=applyPatch(base(),{op:"REMOVE_DEVICE",target:living}).runtime;
  assert.ok(closed.devices["客厅::climate::ac-1"]);
  assert.equal(removed.devices["客厅::climate::ac-1"],undefined);
});

test("明确替换目标时才允许旧目标被移除",()=>{
  const before=base();
  const added=applyPatch(before,{op:"ADD_DEVICE",target:bedroom,slots:{power:"ON"}}).runtime;
  assert.ok(added.devices["客厅::climate::ac-1"]);
  const replaced=applyPatch(before,{op:"REPLACE_TARGET",from:living,to:bedroom,remove_old:true,slots:{power:"ON"}}).runtime;
  assert.equal(replaced.devices["客厅::climate::ac-1"],undefined);
  assert.equal(replaced.devices["主卧::climate::ac-1"].slots.power,"ON");
});

test("显式保持不变建立保护 invariant，后续写入必须失败",()=>{
  const protectedState=applyPatch(base(),{op:"PROTECT",target:living,slot:"temperature",reason:"客厅那个保持不变"}).runtime;
  assert.throws(()=>applyPatch(protectedState,{op:"PATCH_SLOT",target:living,slot:"temperature",value:20}),/protected_invariant_write/);
  const {runtime}=applyPatch(protectedState,{op:"PATCH_SLOT",target:living,slot:"mode",value:"DRY"});
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.temperature,24);
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.mode,"DRY");
});

test("撤销已执行动作必须提供显式补偿动作",()=>{
  assert.throws(()=>applyPatch(base(),{op:"UNDO_EXECUTED",execution_id:"e1"}),/undo_requires_explicit_compensation/);
  const {runtime}=applyPatch(base(),{op:"UNDO_EXECUTED",execution_id:"e1",compensation:{op:"PATCH_SLOT",target:living,slot:"temperature",value:26}});
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.temperature,26);
  assert.equal(runtime.executionLedger.at(-1).compensates,"e1");
});

test("多设备并行 patch 只修改 write-set",()=>{
  const before=base();
  const {runtime}=applyTurn(before,[
    {op:"PATCH_SLOT",target:living,slot:"temperature",value:23},
    {op:"PATCH_SLOT",target:window,slot:"opening",value:30},
    {op:"ADD_DEVICE",target:bedroom,slots:{power:"ON",temperature:25}}
  ]);
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.temperature,23);
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.mode,"COOL");
  assert.equal(runtime.devices["客厅::window::w-1"].slots.opening,30);
  assert.equal(runtime.devices["主卧::climate::ac-1"].slots.temperature,25);
});

test("invariant gate detects accidental unrelated mutation",()=>{
  const before=base(),after=base();
  after.devices["客厅::window::w-1"].slots.opening=0;
  assert.throws(()=>assertUntouchedStatePreserved(before,after,{op:"PATCH_SLOT",target:living,slot:"temperature",value:22}),/untouched_state_mutation/);
});


test("相对槽位修改只基于当前值产生最小增量",()=>{
  const before=base();
  const {runtime}=applyPatch(before,{op:"PATCH_RELATIVE",target:living,slot:"temperature",delta:-2});
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.temperature,22);
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.power,"ON");
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.mode,"COOL");
  assert.deepEqual(runtime.devices["客厅::window::w-1"],before.devices["客厅::window::w-1"]);
});

test("集合指代展开为多个独立 patch，不覆盖集合外设备",()=>{
  const before=base();
  const withBedroom=applyPatch(before,{op:"ADD_DEVICE",target:bedroom,slots:{power:"OFF",temperature:25}}).runtime;
  const {runtime,receipts}=applyTurn(withBedroom,[{op:"PATCH_SLOT",targets:[living,bedroom],slot:"temperature",value:23}]);
  assert.equal(receipts.length,2);
  assert.equal(runtime.devices["客厅::climate::ac-1"].slots.temperature,23);
  assert.equal(runtime.devices["主卧::climate::ac-1"].slots.temperature,23);
  assert.deepEqual(runtime.devices["客厅::window::w-1"],withBedroom.devices["客厅::window::w-1"]);
});

test("集合 patch 禁止同时声明 target 和 targets，避免歧义写入",()=>{
  assert.throws(()=>applyTurn(base(),[{op:"PATCH_SLOT",target:living,targets:[bedroom],slot:"temperature",value:21}]),/set_patch_cannot_mix/);
});
