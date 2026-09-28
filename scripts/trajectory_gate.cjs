"use strict";
const {applyTurn,normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const AC_L={area:"客厅",entity:"空调"},AC_B={area:"主卧",entity:"空调"},WIN={area:"客厅",entity:"窗户"},LIGHT={area:"主卧",entity:"灯"};
function base(){
 let r=normalizeRuntime();
 r=applyTurn(r,[{op:"ADD_DEVICE",target:AC_L,slots:{power:"ON",temperature:24}},{op:"ADD_DEVICE",target:WIN,slots:{power:"ON",opening:30}},{op:"ADD_DEVICE",target:LIGHT,slots:{power:"OFF"}}]).runtime;return r;
}
function make(id,n){
 const seq=[
  [{op:"ADD_DEVICE",target:AC_B,slots:{power:"ON",temperature:25}}],
  [{op:"PATCH_SLOT",target:AC_L,slot:"temperature",value:23}],
  [{op:"PATCH_RELATIVE",target:AC_B,slot:"temperature",delta:-1}],
  [{op:"PATCH_SLOT",targets:[AC_L,AC_B],slot:"temperature",value:22}],
  [{op:"PROTECT",target:AC_L,slot:"temperature",reason:"user_keep"}],
  [{op:"CLOSE_DEVICE",target:WIN,slot:"power",value:"OFF"}],
  [{op:"PATCH_SLOT",target:LIGHT,slot:"power",value:"ON"}],
  [{op:"REPLACE_TARGET",from:LIGHT,to:{area:"客厅",entity:"灯"},remove_old:true,slots:{power:"ON"}}],
  [{op:"CLOSE_DEVICE",target:AC_B,slot:"power",value:"OFF"}],
  [{op:"REMOVE_DEVICE",target:AC_B}],
 ];
 const turns=[];for(let i=0;i<n;i++)turns.push({turn:i+1,patches:seq[(i+id)%seq.length]});return {id:"traj-"+id,turns};
}
function evaluate(){
 let total=0,ok=0,judgementOk=0,wrong=0,untouched=0,blocked=0,invalid=0;const errors={};const trajectories=[];
 for(let k=0;k<30;k++){
  const t=make(k,10+(k%21));let r=base(),pass=true;
  for(const turn of t.turns){total++;try{const out=applyTurn(r,turn.patches);for(const rec of out.receipts){if(!rec.invariant.ok)untouched++;}r=out.runtime;ok++;}catch(e){pass=false;const msg=String(e.message);errors[msg]=(errors[msg]||0)+1;
 if(msg.startsWith("untouched_state_mutation"))untouched++;
 else if(msg.startsWith("protected_invariant_write")){blocked++;judgementOk++;}
 else if(msg.includes("requires_existing_value")||msg.includes("not_found")){invalid++;judgementOk++;}
 else wrong++;
 }}
  trajectories.push({id:t.id,turns:t.turns.length,pass});
 }
 const report={truth:"persistent_10_30_turn_runtime_trajectory_gate",trajectories:trajectories.length,turns:total,turn_success:ok/total,raw_execution_trajectory_success:trajectories.filter(x=>x.pass).length/trajectories.length,judgement_aware_turn_success:(ok+judgementOk)/total,wrong_device:wrong,blocked_by_invariant:blocked,invalid_state_transition:invalid,untouched_state_violation:untouched,errors};
 if(report.judgement_aware_turn_success<.90||wrong!==0||untouched!==0)process.exitCode=1;
 console.log(JSON.stringify(report,null,2));
}
evaluate();
