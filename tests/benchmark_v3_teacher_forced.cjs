"use strict";
const assert=require("assert");
const {classify,goldPatch,runtimeAtGoldPrefix,goldHistoryPrefix}=require("../scripts/run_benchmark_v3_teacher_forced.cjs");

const turn={
  gold_decision:"EXECUTE",gold_op:"PATCH_SLOT",
  gold_target:{area:"客厅",entity:"窗",instance:"default"},
  gold_slot:"opening",gold_value:40
};
assert.deepEqual(classify(turn,{decision:"EXECUTE",patches:[{
  op:"PATCH_SLOT",target:{area:"客厅",entity:"窗",instance:"default"},slot:"opening",value:40
}]}),{ok:true,primary:null,dimensions:[]});
assert.equal(classify(turn,{decision:"CLARIFY",patches:[]}).primary,"decision");
assert.equal(classify(turn,{decision:"EXECUTE",patches:[]}).primary,"missing_patch");
assert.equal(classify(turn,{decision:"EXECUTE",patches:[{
  op:"PATCH_SLOT",target:{area:"书房",entity:"窗",instance:"default"},slot:"opening",value:40
}]}).primary,"target");
assert.equal(classify(turn,{decision:"EXECUTE",patches:[{
  op:"PATCH_SLOT",target:{area:"客厅",entity:"窗",instance:"default"},slot:"opening"
}]}).primary,"value");

const tr={
 initial_runtime:{devices:{
  "客厅::窗::default":{area:"客厅",entity:"窗",instance:"default",slots:{power:"OFF",opening:0}}
 }},
 turns:[
  {...turn,text:"客厅窗开到40",gold_state:{"客厅::窗::default":{power:"OFF",opening:40}}},
  {...turn,text:"还是它开到40",gold_state:{"客厅::窗::default":{power:"OFF",opening:40}}}
 ]
};
assert.equal(runtimeAtGoldPrefix(tr,1).devices["客厅::窗::default"].slots.opening,40);
const h=goldHistoryPrefix(tr,1);
assert.equal(h.length,1);assert.equal(h[0].committed,true);assert.equal(h[0].applied_patches[0].op,"PATCH_SLOT");
{
 const aliasTurn={...turn,text:"客厅外窗开度40",surface_naming_class:"non_standard_alias",instruction_shape:"single_intent"};
 const cls=classify(aliasTurn,{decision:"EXECUTE",patches:[{
  op:"PATCH_SLOT",target:{area:"客厅",entity:"窗",instance:"default"},slot:"opening",value:40
 }]});
 assert.equal(cls.ok,true);
}
console.log(JSON.stringify({ok:true,contract:"teacher-forced evaluation uses canonical gold targets across surface aliases and exposes robustness slices"}));
