"use strict";
const assert = require("assert");
const {MockThingDriver, executePhysicalTurn} = require("../scripts/physical_runtime.cjs");
const {normalizeRuntime} = require("../scripts/whole_home_patch_contract.cjs");

const L = {area:"客厅",entity:"空调",instance:"default"};
const B = {area:"主卧",entity:"空调",instance:"default"};
const initial = normalizeRuntime({devices:{
  "客厅::空调::default":{key:"客厅::空调::default",area:"客厅",entity:"空调",instance:"default",slots:{power:"ON",temperature:24}},
  "主卧::空调::default":{key:"主卧::空调::default",area:"主卧",entity:"空调",instance:"default",slots:{power:"ON",temperature:25}}
}});

// Accepted relative action: physical observation is authoritative.
{
  const driver = new MockThingDriver(initial);
  const out = executePhysicalTurn(initial,[{op:"PATCH_RELATIVE",target:B,slot:"temperature",delta:-1}],driver);
  assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,24);
  assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,24);
  assert.equal(out.receipts[0].status,"applied");
}

// Device rejection: requested state must not leak into observed runtime.
{
  const driver = new MockThingDriver(initial,{reject:p=>p.target && p.target.area==="主卧"});
  const out = executePhysicalTurn(initial,[{op:"PATCH_SLOT",target:B,slot:"temperature",value:19}],driver);
  assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,25);
  assert.equal(out.receipts[0].status,"rejected");
}

// Physical device may clamp a request; reconciled state follows observation, not desire.
{
  const driver = new MockThingDriver(initial,{
    transform:p => p.op==="PATCH_SLOT" && p.slot==="temperature" && p.value<18 ? {value:18} : null
  });
  const out = executePhysicalTurn(initial,[{op:"PATCH_SLOT",target:B,slot:"temperature",value:15}],driver);
  assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,18);
  assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,24);
  assert.equal(out.receipts[0].physical_patch.value,15);
  assert.equal(out.receipts[0].observation.slots.temperature,18);
}

console.log(JSON.stringify({ok:true,cases:3,contract:"patch->execute->observe->reconcile"}));
