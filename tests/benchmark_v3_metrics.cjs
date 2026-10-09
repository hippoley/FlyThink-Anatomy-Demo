"use strict";
const assert=require("assert");
const {bucket,addTurn,finish,strictSuccess,analyzePrefix}=require("../scripts/run_long_checkpoint_e2e_v3.cjs");
{
 const b=bucket();
 addTurn(b,{gold_decision:"EXECUTE"},{outcome:"EXECUTE",ok:true,state_ok:true});
 addTurn(b,{gold_decision:"CLARIFY"},{outcome:"EXECUTE",ok:false,state_ok:true});
 assert.deepEqual(finish(b),{turns:2,decision_exact:.5,full_patch_exact:.5,state_after_turn_exact:1});
}
assert.equal(strictSuccess({strict_trajectory_exact:true,unsafe_execute:0,wrong_device:0,untouched_state_violation:0}),true);
assert.equal(strictSuccess({strict_trajectory_exact:true,unsafe_execute:1,wrong_device:0,untouched_state_violation:0}),false);
{
 const turns=[
  {gold_decision:"EXECUTE",gold_target:{area:"客厅",entity:"空调",instance:"default"}},
  {gold_decision:"CLARIFY"},
  {gold_decision:"EXECUTE",gold_target:{area:"主卧",entity:"灯",instance:"default"}}
 ];
 const rows=[
  {ok:true,state_ok:true,committed:true,applied_patches:[{target:turns[0].gold_target}]},
  {ok:false,state_ok:false,committed:true,applied_patches:[{target:{area:"客厅",entity:"窗",instance:"default"}}]},
  {ok:false,state_ok:false,committed:true,applied_patches:[{target:{area:"客厅",entity:"空调",instance:"default"}}]}
 ];
 assert.deepEqual(analyzePrefix(turns,rows),{
  clean_prefix_turns:2,
  clean_prefix_unsafe_execute:1,
  clean_prefix_wrong_device:0,
  first_failure_turn:2,
  clean_prefix_fraction:1/3
 });
}
console.log(JSON.stringify({ok:true,contract:"v3 metrics expose decision, patch, state, scenario, difficulty, generalization class, causal clean-prefix safety and repeated strict+safety reliability"}));
