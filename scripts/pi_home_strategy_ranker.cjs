"use strict";

const {getPath}=require("./desired_state_evaluator.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function compare(actual,rule){
  const op=rule.op||"==";
  if(actual===undefined)return false;
  switch(op){
    case "==": return actual===rule.value;
    case "!=": return actual!==rule.value;
    case "<": return typeof actual==="number"&&actual<Number(rule.value);
    case "<=": return typeof actual==="number"&&actual<=Number(rule.value);
    case ">": return typeof actual==="number"&&actual>Number(rule.value);
    case ">=": return typeof actual==="number"&&actual>=Number(rule.value);
    case "between": return typeof actual==="number"&&actual>=Number(rule.min)&&actual<=Number(rule.max);
    default: throw new Error("unsupported_strategy_constraint_operator:"+op);
  }
}

function baseEligibility(candidate){
  const outcome=candidate&&candidate.outcome||candidate;
  if(!outcome)return {eligible:false,reason:"outcome_missing"};
  if(outcome.provenance!=="counterfactual_simulation"){
    return {eligible:false,reason:"not_counterfactual_simulation"};
  }
  if(outcome.trusted_for_promotion!==true){
    return {eligible:false,reason:"simulator_not_trusted_for_promotion"};
  }
  if(outcome.strategy&&outcome.strategy.complete_physics_coverage===false){
    return {eligible:false,reason:"incomplete_physics_coverage"};
  }
  return {eligible:true,reason:"trusted_complete_counterfactual"};
}

function evaluateConstraints(outcome,constraints=[]){
  const rows=[];
  for(const rule of constraints||[]){
    const actual=getPath(outcome,rule.path);
    const missing=actual===undefined;
    const satisfied=!missing&&compare(actual,rule);
    rows.push({
      id:rule.id||rule.path,
      path:rule.path,
      actual:clone(actual),
      satisfied,
      missing,
      required:rule.required!==false
    });
  }
  const failedRequired=rows.filter(x=>x.required&&!x.satisfied);
  return {
    satisfied:failedRequired.length===0,
    rows,
    failed_required:failedRequired
  };
}

function objectiveValues(candidates,objectives=[]){
  const bounds={};
  for(const objective of objectives||[]){
    const vals=candidates
      .map(x=>Number(getPath(x.outcome,objective.path)))
      .filter(Number.isFinite);
    if(!vals.length)continue;
    bounds[objective.id||objective.path]={min:Math.min(...vals),max:Math.max(...vals)};
  }
  return bounds;
}

function normalizedObjective(value,bounds,direction){
  if(!Number.isFinite(value)||!bounds)return null;
  if(bounds.max===bounds.min)return 1;
  const t=(value-bounds.min)/(bounds.max-bounds.min);
  return direction==="min"?1-t:t;
}

function rankStrategyCandidates(candidates=[],{
  constraints=[],
  objectives=[]
}={}){
  const prepared=[];
  const blocked=[];
  for(const raw of candidates||[]){
    const candidate={
      label:raw.label||null,
      outcome:clone(raw.outcome||raw)
    };
    const base=baseEligibility(candidate);
    if(!base.eligible){
      blocked.push({...candidate,blocked_reason:base.reason});
      continue;
    }
    const constraintEval=evaluateConstraints(candidate.outcome,constraints);
    if(!constraintEval.satisfied){
      blocked.push({
        ...candidate,
        blocked_reason:"hard_constraint_failed",
        constraints:constraintEval
      });
      continue;
    }
    const missingObjective=(objectives||[]).find(o=>
      o.required!==false && !Number.isFinite(Number(getPath(candidate.outcome,o.path)))
    );
    if(missingObjective){
      blocked.push({
        ...candidate,
        blocked_reason:"required_objective_missing",
        missing_objective:missingObjective.id||missingObjective.path
      });
      continue;
    }
    prepared.push({...candidate,constraints:constraintEval});
  }

  const bounds=objectiveValues(prepared,objectives);
  const ranked=prepared.map(candidate=>{
    let weighted=0,totalWeight=0;
    const objectiveRows=[];
    for(const objective of objectives||[]){
      const id=objective.id||objective.path;
      const actual=Number(getPath(candidate.outcome,objective.path));
      const weight=Number(objective.weight===undefined?1:objective.weight);
      const normalized=normalizedObjective(actual,bounds[id],objective.direction||"max");
      if(normalized!==null&&weight>0){
        weighted+=normalized*weight;
        totalWeight+=weight;
      }
      objectiveRows.push({
        id,
        path:objective.path,
        direction:objective.direction||"max",
        actual:Number.isFinite(actual)?actual:null,
        normalized,
        weight
      });
    }
    const score=totalWeight?weighted/totalWeight:1;
    return {
      ...candidate,
      score:Number(score.toFixed(4)),
      objectives:objectiveRows
    };
  }).sort((a,b)=>b.score-a.score||String(a.label).localeCompare(String(b.label)));

  return {
    schema_version:"pi-home-strategy-ranking-v1",
    ranked,
    blocked,
    winner:ranked.length?clone(ranked[0]):null
  };
}

module.exports={
  rankStrategyCandidates,
  baseEligibility,
  evaluateConstraints,
  normalizedObjective
};
