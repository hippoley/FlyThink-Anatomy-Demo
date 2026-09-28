"use strict";
const assert=require("assert");
const {runInstrumentedTurn}=require("../scripts/commitbench_trace.cjs");

const runtime={devices:{
  "客厅::灯::default":{key:"客厅::灯::default",area:"客厅",entity:"灯",instance:"default",slots:{power:"ON",brightness:40}},
  "主卧::灯::default":{key:"主卧::灯::default",area:"主卧",entity:"灯",instance:"default",slots:{power:"OFF",brightness:60}}
}};
const out=runInstrumentedTurn(runtime,[{op:"PATCH_SLOT",target:{area:"主卧",entity:"灯",instance:"default"},slot:"power",value:"ON"}]);
assert.equal(out.states.length,2);
assert.equal(out.runtime.devices["主卧::灯::default"].slots.power,"ON");
assert.equal(out.steps.length,1);
assert.ok(out.steps[0].changed_paths.some(x=>x.includes("主卧::灯::default")&&x.includes("power")));
console.log("commitbench trace ok");
