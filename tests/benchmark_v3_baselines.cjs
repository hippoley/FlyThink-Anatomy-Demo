"use strict";
const assert=require("assert");
const {directPatch,relativePatch,correctionPatch,multiPatch}=require("../scripts/run_benchmark_v3_baselines.cjs");

assert.deepEqual(directPatch("客厅空调我想要温度19"),{
  op:"PATCH_SLOT",target:{area:"客厅",entity:"空调",instance:"default"},slot:"temperature",value:19
});
assert.equal(directPatch("客厅跟书房这两处空调，温度统一到22"),null);
assert.deepEqual(relativePatch("还是它，再大一点",{focused_target:{area:"客厅",entity:"窗",instance:"default"}}),{
  op:"PATCH_RELATIVE",target:{area:"客厅",entity:"窗",instance:"default"},slot:"opening",delta:10
});
assert.deepEqual(correctionPatch("更正一下，目标不是主卧而是次卧灯，亮度80"),{
  op:"PATCH_SLOT",target:{area:"次卧",entity:"灯",instance:"default"},slot:"brightness",value:80
});
assert.deepEqual(multiPatch("客厅跟书房这两处窗，开度统一到60"),{
  op:"PATCH_SLOT",
  targets:[
    {area:"客厅",entity:"窗",instance:"default"},
    {area:"书房",entity:"窗",instance:"default"}
  ],
  slot:"opening",value:60
});
console.log(JSON.stringify({ok:true,contract:"benchmark validity baselines are deterministic and capability-bounded"}));
