"use strict";
const {run}=require("./stateful_checkpoint_trajectory.cjs");
const L={area:"客厅",entity:"空调",instance:"default"},B={area:"主卧",entity:"空调",instance:"default"};
const trajectory={initial_runtime:{devices:{
 "客厅::空调::default":{key:"客厅::空调::default",area:"客厅",entity:"空调",instance:"default",status:"mounted",model_id:"AWGD-ZA01",slots:{power:"ON",temperature:24}},
 "主卧::空调::default":{key:"主卧::空调::default",area:"主卧",entity:"空调",instance:"default",status:"mounted",model_id:"AWGD-ZA01",slots:{power:"OFF",temperature:25}}
}},turns:[
 {text:"客厅空调关掉",context_hint:{focused_target:L},gold_decision:"EXECUTE",gold_op:"CLOSE_DEVICE",gold_target:L,gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"OFF",temperature:25}}},
 {text:"卧室的也打开",context_hint:{add_target:B},gold_decision:"EXECUTE",gold_op:"ADD_DEVICE",gold_target:B,gold_slots:{power:"ON"},gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"ON",temperature:25}}},
 {text:"温度调到23度",gold_decision:"EXECUTE",gold_op:"PATCH_SLOT",gold_target:B,gold_slot:"temperature",gold_value:23,gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"ON",temperature:23}}},
 {text:"再低一点",gold_decision:"EXECUTE",gold_op:"PATCH_RELATIVE",gold_target:B,gold_slot:"temperature",gold_delta:-1,gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"ON",temperature:22}}},
 {text:"把它关掉",gold_decision:"EXECUTE",gold_op:"CLOSE_DEVICE",gold_target:B,gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"OFF",temperature:22}}},
 {text:"现在这个再打开",gold_decision:"EXECUTE",gold_op:"ADD_DEVICE",gold_target:B,gold_slots:{power:"ON"},gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"ON",temperature:22}}},
 {text:"再低一点",gold_decision:"EXECUTE",gold_op:"PATCH_RELATIVE",gold_target:B,gold_slot:"temperature",gold_delta:-1,gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"ON",temperature:21}}},
 {text:"关掉它",gold_decision:"EXECUTE",gold_op:"CLOSE_DEVICE",gold_target:B,gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"OFF",temperature:21}}},
 {text:"再打开",gold_decision:"EXECUTE",gold_op:"ADD_DEVICE",gold_target:B,gold_slots:{power:"ON"},gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"ON",temperature:21}}},
 {text:"温度调到24度",gold_decision:"EXECUTE",gold_op:"PATCH_SLOT",gold_target:B,gold_slot:"temperature",gold_value:24,gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"ON",temperature:24}}},
 {text:"再低一点",gold_decision:"EXECUTE",gold_op:"PATCH_RELATIVE",gold_target:B,gold_slot:"temperature",gold_delta:-1,gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"ON",temperature:23}}},
 {text:"把它关掉",gold_decision:"EXECUTE",gold_op:"CLOSE_DEVICE",gold_target:B,gold_state:{"客厅::空调::default":{power:"OFF",temperature:24},"主卧::空调::default":{power:"OFF",temperature:23}}}
]};
const a=process.argv.slice(2),arg=n=>{const i=a.indexOf(n);return i>=0?a[i+1]:null};
run(trajectory,{graph:arg("--graph"),judgement:arg("--judgement"),semantic:arg("--semantic"),physical:arg("--physical")}).then(r=>{console.log(JSON.stringify(r));process.exit(r.untouched_state_violation?2:0)});
