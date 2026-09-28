"use strict";
const {run}=require("./stateful_checkpoint_trajectory.cjs");
const L={area:"客厅",entity:"空调",instance:"default"},B={area:"主卧",entity:"空调",instance:"default"};
const trajectory={initial_runtime:{devices:{
 "客厅::空调::default":{key:"客厅::空调::default",area:"客厅",entity:"空调",instance:"default",status:"mounted",model_id:"AWGD-ZA01",slots:{power:"ON",temperature:24}},
 "主卧::空调::default":{key:"主卧::空调::default",area:"主卧",entity:"空调",instance:"default",status:"mounted",model_id:"AWGD-ZA01",slots:{power:"OFF",temperature:25}}
}},turns:[
 {text:"客厅空调关掉",context_hint:{focused_target:L},gold_decision:"EXECUTE",gold_op:"CLOSE_DEVICE",gold_target:L},
 {text:"卧室的也打开",context_hint:{add_target:B},gold_decision:"EXECUTE",gold_op:"ADD_DEVICE",gold_target:B},
 {text:"温度调到23度",gold_decision:"EXECUTE",gold_op:"PATCH_SLOT",gold_target:B},
 {text:"再低一点",gold_decision:"EXECUTE",gold_op:"PATCH_RELATIVE",gold_target:B},
 {text:"把它关掉",gold_decision:"EXECUTE",gold_op:"CLOSE_DEVICE",gold_target:B},
 {text:"现在这个再打开",gold_decision:"EXECUTE",gold_op:"ADD_DEVICE",gold_target:B},
 {text:"再低一点",gold_decision:"EXECUTE",gold_op:"PATCH_RELATIVE",gold_target:B},
 {text:"关掉它",gold_decision:"EXECUTE",gold_op:"CLOSE_DEVICE",gold_target:B},
 {text:"再打开",gold_decision:"EXECUTE",gold_op:"ADD_DEVICE",gold_target:B},
 {text:"温度调到24度",gold_decision:"EXECUTE",gold_op:"PATCH_SLOT",gold_target:B},
 {text:"再低一点",gold_decision:"EXECUTE",gold_op:"PATCH_RELATIVE",gold_target:B},
 {text:"把它关掉",gold_decision:"EXECUTE",gold_op:"CLOSE_DEVICE",gold_target:B}
]};
const a=process.argv.slice(2),arg=n=>a[a.indexOf(n)+1];
run(trajectory,{graph:arg("--graph"),judgement:arg("--judgement"),semantic:arg("--semantic")}).then(r=>{console.log(JSON.stringify(r));process.exit(r.untouched_state_violation?2:0)});
