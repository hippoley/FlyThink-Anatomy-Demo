"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function canonical(v){
  if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
  if(v&&typeof v==="object"){
    return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  }
  return JSON.stringify(v);
}
function targetFromDecision(decision={}){
  const patches=Array.isArray(decision.patches)?decision.patches:[];
  const p=patches.find(x=>x&&x.target);
  return p&&p.target?clone(p.target):null;
}
function numericFeatures(candidate={}){
  const out={};
  for(const [k,v] of Object.entries(candidate.features||{})){
    if(typeof v==="number"&&Number.isFinite(v))out[k]=v;
    else if(typeof v==="boolean")out[k]=v?1:0;
  }
  return out;
}

function learnCandidatePreferences(train_cases=[]){
  const families={};
  const rejected=[];
  for(const c of train_cases||[]){
    const family=c&&c.context&&c.context.intent_family;
    const candidates=c&&c.context&&c.context.candidates;
    const chosenTarget=targetFromDecision(c&&c.replay||{});
    if(!family||!Array.isArray(candidates)||candidates.length<2||!chosenTarget){
      rejected.push({id:c&&c.id||null,reason:"candidate_training_case_incomplete"});
      continue;
    }
    const chosen=candidates.find(x=>canonical(x.target)===canonical(chosenTarget));
    if(!chosen){
      rejected.push({id:c.id,reason:"chosen_target_not_in_candidates"});
      continue;
    }
    const others=candidates.filter(x=>x!==chosen);
    const cf=numericFeatures(chosen);
    if(!families[family])families[family]={};
    for(const [feature,value] of Object.entries(cf)){
      const otherValues=others.map(x=>numericFeatures(x)[feature]).filter(Number.isFinite);
      if(!otherValues.length)continue;
      const mean=otherValues.reduce((a,b)=>a+b,0)/otherValues.length;
      const diff=value-mean;
      if(diff===0)continue;
      if(!families[family][feature])families[family][feature]={positive:0,negative:0,support:0};
      const stat=families[family][feature];
      if(diff>0)stat.positive++; else stat.negative++;
      stat.support++;
    }
  }

  const rules={};
  for(const [family,features] of Object.entries(families)){
    const learned={};
    for(const [feature,stat] of Object.entries(features)){
      if(stat.positive===stat.negative)continue;
      learned[feature]={
        direction:stat.positive>stat.negative?"max":"min",
        support:Math.max(stat.positive,stat.negative),
        observations:stat.support,
        confidence:Number((Math.max(stat.positive,stat.negative)/stat.support).toFixed(4))
      };
    }
    if(Object.keys(learned).length)rules[family]={intent_family:family,features:learned};
    else rejected.push({id:family,reason:"no_stable_candidate_feature_preference"});
  }
  return {
    schema_version:"pi-home-candidate-preference-rules-v1",
    rules,
    rejected
  };
}

function rankCandidates(candidates=[],rule={}){
  const featureRules=rule.features||{};
  const rows=(candidates||[]).map((candidate,index)=>({
    index,
    candidate:clone(candidate),
    score:0,
    feature_scores:{}
  }));
  for(const [feature,pref] of Object.entries(featureRules)){
    const values=rows.map(r=>numericFeatures(r.candidate)[feature]);
    const finite=values.filter(Number.isFinite);
    if(finite.length!==rows.length||!finite.length)continue;
    const min=Math.min(...finite),max=Math.max(...finite);
    for(let i=0;i<rows.length;i++){
      const raw=values[i];
      const norm=max===min?1:(raw-min)/(max-min);
      const aligned=pref.direction==="min"?1-norm:norm;
      const weight=Number(pref.confidence||1);
      rows[i].score+=aligned*weight;
      rows[i].feature_scores[feature]={
        raw,
        direction:pref.direction,
        normalized:Number(aligned.toFixed(4)),
        weight
      };
    }
  }
  return rows.sort((a,b)=>b.score-a.score||a.index-b.index);
}

function createCandidateRankPolicy({train_cases=[],baselinePredict}={}){
  if(typeof baselinePredict!=="function")throw new Error("baseline_predict_required");
  const learned=learnCandidatePreferences(train_cases);
  return {
    learned,
    predict:async input=>{
      const baseline=await baselinePredict(input);
      const family=input&&input.context&&input.context.intent_family;
      const rule=family&&learned.rules[family];
      const candidates=input&&input.context&&input.context.candidates;
      if(!rule)return {...clone(baseline),candidate_transfer:false,transfer_reason:"rule_missing"};
      if(!Array.isArray(candidates)||!candidates.length){
        return {...clone(baseline),candidate_transfer:false,transfer_reason:"candidates_missing"};
      }
      const ranked=rankCandidates(candidates,rule);
      if(!ranked.length)return {...clone(baseline),candidate_transfer:false,transfer_reason:"ranking_empty"};
      const patches=Array.isArray(baseline.patches)?clone(baseline.patches):[];
      const idx=patches.findIndex(x=>x&&x.target);
      if(idx<0)return {...clone(baseline),candidate_transfer:false,transfer_reason:"target_patch_missing"};
      patches[idx].target=clone(ranked[0].candidate.target);
      return {
        ...clone(baseline),
        patches,
        goal_completed:true,
        requires_correction:false,
        replay_conditioned:false,
        candidate_transfer:true,
        candidate_ranking:ranked.map(x=>({
          target:clone(x.candidate.target),
          score:Number(x.score.toFixed(4)),
          feature_scores:clone(x.feature_scores)
        }))
      };
    }
  };
}

module.exports={
  learnCandidatePreferences,
  rankCandidates,
  createCandidateRankPolicy,
  numericFeatures,
  targetFromDecision
};
