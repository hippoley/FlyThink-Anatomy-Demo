"use strict";

function clamp(v){return Math.max(0,Math.min(1,Number(v)||0))}

function lastStep(trajectory){
  const steps=Array.isArray(trajectory&&trajectory.steps)?trajectory.steps:[];
  return steps.length?steps[steps.length-1]:null;
}

function interventionPenalty(interventions=[]){
  let penalty=0;
  for(const x of interventions||[]){
    if(!x)continue;
    if(x.kind==="PREFERENCE_FEEDBACK")penalty+=0.05;
    else if(x.kind==="CORRECTION")penalty+=0.15;
    else if(x.kind==="TAKEOVER")penalty+=0.35;
    else if(x.kind==="CANCEL")penalty+=0.4;
  }
  return clamp(1-penalty);
}

function outcomeScore(label){
  switch(label){
    case "SUCCESS": return 1;
    case "HUMAN_TAKEOVER": return 0.45;
    case "CANCELLED_BY_USER": return 0.35;
    case "BLOCKED_EVIDENCE": return 0.3;
    case "BUDGET_EXHAUSTED": return 0.2;
    case "STALLED": return 0.15;
    case "OSCILLATION": return 0.05;
    default: return 0.1;
  }
}

function stabilityScore(label){
  if(label==="OSCILLATION")return 0;
  if(label==="STALLED")return 0.25;
  if(label==="BUDGET_EXHAUSTED")return 0.5;
  return 1;
}

function scoreTrajectory(trajectory,weights={}){
  if(!trajectory||trajectory.schema_version!=="pi-home-trajectory-v1"){
    throw new Error("unsupported_trajectory_schema");
  }
  const w={
    outcome:0.35,
    progress:0.25,
    efficiency:0.15,
    intervention:0.15,
    stability:0.10,
    ...weights
  };
  const totalWeight=Object.values(w).reduce((a,b)=>a+Number(b||0),0);
  if(totalWeight<=0)throw new Error("trajectory_score_weights_required");

  const label=trajectory.outcome&&trajectory.outcome.label||"INCOMPLETE";
  const last=lastStep(trajectory);
  const progress=last&&typeof last.score==="number"?clamp(last.score):(label==="SUCCESS"?1:0);
  const actions=Number(trajectory.summary&&trajectory.summary.physical_actions||0);
  const steps=Math.max(1,Number(trajectory.summary&&trajectory.summary.steps||0));
  const efficiency=clamp(1-Math.max(0,actions-steps)/Math.max(1,steps*2));
  const intervention=interventionPenalty(trajectory.interventions||[]);
  const components={
    outcome:outcomeScore(label),
    progress,
    efficiency,
    intervention,
    stability:stabilityScore(label)
  };
  const raw=Object.entries(components).reduce((sum,[k,v])=>sum+v*Number(w[k]||0),0)/totalWeight;
  const score=clamp(raw);
  const quality=score>=0.8?"HIGH":(score>=0.5?"MEDIUM":"LOW");
  return {
    score:Number(score.toFixed(4)),
    quality,
    components,
    outcome_label:label,
    trainable:true,
    positive_example:quality==="HIGH"&&label==="SUCCESS",
    negative_example:["LOW"].includes(quality)
  };
}

module.exports={scoreTrajectory,outcomeScore,stabilityScore,interventionPenalty};
