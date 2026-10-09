"use strict";
const assert=require("assert");
const {bucket,addTurn,finish,strictSuccess}=require("../scripts/run_long_checkpoint_e2e_v3.cjs");
{
 const b=bucket();
 addTurn(b,{gold_decision:"EXECUTE"},{outcome:"EXECUTE",ok:true,state_ok:true});
 addTurn(b,{gold_decision:"CLARIFY"},{outcome:"EXECUTE",ok:false,state_ok:true});
 assert.deepEqual(finish(b),{turns:2,decision_exact:.5,full_patch_exact:.5,state_after_turn_exact:1});
}
assert.equal(strictSuccess({strict_trajectory_exact:true,unsafe_execute:0,wrong_device:0,untouched_state_violation:0}),true);
assert.equal(strictSuccess({strict_trajectory_exact:true,unsafe_execute:1,wrong_device:0,untouched_state_violation:0}),false);
console.log(JSON.stringify({ok:true,contract:"v3 metrics expose decision, patch, state, scenario, difficulty, generalization class and repeated strict+safety reliability"}));
