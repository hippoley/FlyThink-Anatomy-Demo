"use strict";

const {decisionMetrics,aggregate,delta}=require("./pi_home_offline_replay_eval.cjs");

function splitCases(cases=[]){
  const out={seen:[],compositional:[],topology:[]};
  for(const c of cases||[]){
    const split=c&&c.split;
    if(!Object.prototype.hasOwnProperty.call(out,split)){
      throw new Error("unsupported_generalization_split:"+String(split));
    }
    out[split].push(c);
  }
  return out;
}

async function evaluatePolicyOnCases(cases,{baselinePredict,experimentalPredict}={}){
  if(typeof baselinePredict!=="function")throw new Error("baseline_predict_required");
  if(typeof experimentalPredict!=="function")throw new Error("experimental_predict_required");
  const rows=[];
  for(const c of cases||[]){
    const baseline=await baselinePredict(c);
    const experimental=await experimentalPredict(c);
    const b=decisionMetrics(baseline||{},c.gold||{});
    const e=decisionMetrics(experimental||{},c.gold||{});
    rows.push({
      id:c.id,
      split:c.split,
      baseline:b,
      experimental:e,
      exact_replay_hit:experimental&&experimental.replay_conditioned===true?1:0,
      delta:delta(b,e)
    });
  }
  const ba=aggregate(rows.map(x=>x.baseline));
  const ea=aggregate(rows.map(x=>x.experimental));
  return {
    cases:rows.length,
    baseline:ba,
    experimental:ea,
    delta:delta(ba,ea),
    exact_replay_hits:rows.reduce((a,x)=>a+x.exact_replay_hit,0),
    rows
  };
}

async function evaluateGeneralizationSuite(cases=[],predictors={}){
  const splits=splitCases(cases);
  const seen=await evaluatePolicyOnCases(splits.seen,predictors);
  const compositional=await evaluatePolicyOnCases(splits.compositional,predictors);
  const topology=await evaluatePolicyOnCases(splits.topology,predictors);

  const holdoutCases=[...splits.compositional,...splits.topology];
  const holdout=await evaluatePolicyOnCases(holdoutCases,predictors);
  const improved=
    holdout.delta.wrong_target_reduction>0 ||
    holdout.delta.correction_reduction>0 ||
    holdout.delta.extra_action_reduction>0 ||
    holdout.delta.goal_completion_gain>0;

  return {
    schema_version:"pi-home-generalization-eval-v1",
    seen,
    compositional,
    topology,
    holdout,
    claim:{
      exact_replay_hits_on_holdout:holdout.exact_replay_hits,
      generalization_reality_delta:
        holdout.cases>0 &&
        holdout.exact_replay_hits===0 &&
        improved,
      reason:
        holdout.exact_replay_hits>0
          ?"holdout_contaminated_by_exact_replay"
          :(improved?"unseen_holdout_improved_without_exact_replay":"no_unseen_holdout_improvement")
    }
  };
}

module.exports={splitCases,evaluatePolicyOnCases,evaluateGeneralizationSuite};
