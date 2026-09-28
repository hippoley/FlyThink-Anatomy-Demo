"use strict";
const assert=require("assert");const {runTrajectory}=require("../scripts/e2e_trajectory_protocol.cjs");
const t={initial_runtime:{},turns:[
 {text:"打开它",gold_decision:"CLARIFY"},
 {text:"保持这个不变",gold_decision:"BLOCK"},
 {text:"现在执行",gold_decision:"EXECUTE"},
]};
let i=0;const scripted=[{decision:"CLARIFY"},{decision:"BLOCK"},{decision:"EXECUTE",patches:[]}];
const r=runTrajectory(t,()=>scripted[i++]);
assert.equal(r.turn_accuracy,1);assert.equal(r.wrong_device,0);assert.equal(r.untouched_state_violation,0);
i=0;const bad=runTrajectory(t,()=>({decision:"EXECUTE",patches:[]}));
assert(bad.turn_accuracy<1);assert(bad.wrong_device>0);
console.log(JSON.stringify({ok:true,perfect:r.turn_accuracy,bad:bad.turn_accuracy}));
