"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function keyTarget(t){return t&&[t.area,t.entity,t.instance||"default"].join("::")}
function patchTargets(patches=[]){
  const out=[];
  for(const p of patches||[]){
    if(p&&p.target)out.push(keyTarget(p.target));
    for(const t of (p&&p.targets)||[])out.push(keyTarget(t));
  }
  return out.filter(Boolean);
}
function wrongTargetCount(patches=[],expectedTargets=[]){
  const expected=new Set((expectedTargets||[]).map(x=>typeof x==="string"?x:keyTarget(x)));
  if(!expected.size)return 0;
  return patchTargets(patches).filter(x=>!expected.has(x)).length;
}
function actionCount(patches=[]){
  let n=0;
  for(const p of patches||[])n+=Array.isArray(p&&p.targets)?p.targets.length:1;
  return n;
}
function decisionMetrics(decision={},gold={}){
  const patches=Array.isArray(decision.patches)?decision.patches:[];
  const wrong=wrongTargetCount(patches,gold.expected_targets||[]);
  const actions=actionCount(patches);
  const desiredActions=Number(gold.expected_action_count||0);
  const extra=Math.max(0,actions-desiredActions);
  const correctionNeeded=wrong>0||decision.requires_correction===true;
  const inferredGoalCompleted=
    wrong===0 &&
    (gold.expected_goal_completion===undefined || gold.expected_goal_completion===true) &&
    actions>=desiredActions;
  const goalCompleted=typeof decision.goal_completed==="boolean"
    ?decision.goal_completed
    :inferredGoalCompleted;
  return {
    wrong_target:wrong,
    correction_needed:correctionNeeded?1:0,
    actions,
    extra_actions:extra,
    goal_completed:goalCompleted?1:0
  };
}
function aggregate(rows=[]){
  const sum=(k)=>rows.reduce((a,x)=>a+Number(x[k]||0),0);
  const n=Math.max(1,rows.length);
  return {
    cases:rows.length,
    wrong_target:sum("wrong_target"),
    correction_needed:sum("correction_needed"),
    actions:sum("actions"),
    extra_actions:sum("extra_actions"),
    goal_completed:sum("goal_completed"),
    goal_completion_rate:sum("goal_completed")/n
  };
}
function delta(base,replay){
  return {
    wrong_target_reduction:base.wrong_target-replay.wrong_target,
    correction_reduction:base.correction_needed-replay.correction_needed,
    extra_action_reduction:base.extra_actions-replay.extra_actions,
    action_reduction:base.actions-replay.actions,
    goal_completion_gain:replay.goal_completed-base.goal_completed,
    goal_completion_rate_gain:replay.goal_completion_rate-base.goal_completion_rate
  };
}
function evaluateOfflineReplay(cases=[]){
  const rows=(cases||[]).map(c=>{
    const baseline=decisionMetrics(c.baseline||{},c.gold||{});
    const replay=decisionMetrics(c.replay||{},c.gold||{});
    return {
      id:c.id,
      bucket:c.bucket||null,
      baseline,
      replay,
      delta:delta(baseline,replay),
      evidence:clone(c.evidence||null)
    };
  });
  const baseline=aggregate(rows.map(x=>x.baseline));
  const replay=aggregate(rows.map(x=>x.replay));
  return {
    schema_version:"pi-home-offline-replay-eval-v1",
    cases:rows.length,
    baseline,
    replay,
    delta:delta(baseline,replay),
    rows
  };
}

module.exports={
  evaluateOfflineReplay,decisionMetrics,wrongTargetCount,patchTargets,actionCount,aggregate,delta
};
