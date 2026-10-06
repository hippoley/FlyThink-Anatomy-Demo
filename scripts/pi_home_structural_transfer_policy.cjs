"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function canonical(v){
  if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
  if(v&&typeof v==="object"){
    return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  }
  return JSON.stringify(v);
}
function getPath(obj,path){
  return String(path||"").split(".").filter(Boolean).reduce((cur,key)=>cur==null?undefined:cur[key],obj);
}
function targetFromDecision(decision={}){
  const patches=Array.isArray(decision.patches)?decision.patches:[];
  const p=patches.find(x=>x&&x.target);
  return p&&p.target?clone(p.target):null;
}
function candidateContextPaths(context={}){
  const out=[];
  function walk(value,path){
    if(!value||typeof value!=="object"||Array.isArray(value))return;
    const keys=Object.keys(value);
    if(keys.includes("area")&&keys.includes("entity")){
      out.push(path);
      return;
    }
    for(const key of keys){
      const next=path?path+"."+key:key;
      walk(value[key],next);
    }
  }
  walk(context,"");
  return out.filter(Boolean);
}

function inferTargetSourcePath(context,chosenTarget){
  if(!chosenTarget)return null;
  const chosen=canonical(chosenTarget);
  const matches=candidateContextPaths(context).filter(path=>canonical(getPath(context,path))===chosen);
  if(matches.length!==1)return null;
  return matches[0];
}

function learnStructuralTransferRules(train_cases=[]){
  const byFamily={};
  const rejected=[];
  for(const c of train_cases||[]){
    const family=c&&c.context&&c.context.intent_family;
    if(!family){
      rejected.push({id:c&&c.id||null,reason:"intent_family_missing"});
      continue;
    }
    const chosen=targetFromDecision(c.replay||{});
    const sourcePath=inferTargetSourcePath(c.context||{},chosen);
    if(!sourcePath){
      rejected.push({id:c.id,reason:"unique_structural_target_source_not_found"});
      continue;
    }
    if(!byFamily[family])byFamily[family]=[];
    byFamily[family].push({id:c.id,source_path:sourcePath});
  }

  const rules={};
  for(const [family,rows] of Object.entries(byFamily)){
    const counts={};
    for(const row of rows)counts[row.source_path]=(counts[row.source_path]||0)+1;
    const ranked=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    if(ranked.length===1||ranked[0][1]>ranked[1][1]){
      rules[family]={
        intent_family:family,
        target_source_path:ranked[0][0],
        support:ranked[0][1],
        examples:rows.filter(x=>x.source_path===ranked[0][0]).map(x=>x.id)
      };
    }else{
      rejected.push({id:family,reason:"ambiguous_structural_rule"});
    }
  }
  return {
    schema_version:"pi-home-structural-transfer-rules-v1",
    rules,
    rejected
  };
}

function applyStructuralRule(input,rule){
  const baseline=clone(input.baseline||{});
  const target=getPath(input.context||{},rule.target_source_path);
  if(!target)return {...baseline,structural_transfer:false,transfer_reason:"target_source_missing"};
  const patches=Array.isArray(baseline.patches)?clone(baseline.patches):[];
  const index=patches.findIndex(x=>x&&x.target);
  if(index<0)return {...baseline,structural_transfer:false,transfer_reason:"target_patch_missing"};
  patches[index].target=clone(target);
  return {
    ...baseline,
    patches,
    goal_completed:true,
    requires_correction:false,
    replay_conditioned:false,
    structural_transfer:true,
    transfer_evidence:{
      intent_family:rule.intent_family,
      target_source_path:rule.target_source_path,
      support:rule.support,
      examples:clone(rule.examples)
    }
  };
}

function createStructuralTransferPolicy({train_cases=[],baselinePredict}={}){
  if(typeof baselinePredict!=="function")throw new Error("baseline_predict_required");
  const learned=learnStructuralTransferRules(train_cases);
  return {
    learned,
    predict:async input=>{
      const baseline=await baselinePredict(input);
      const family=input&&input.context&&input.context.intent_family;
      const rule=family&&learned.rules[family];
      if(!rule)return {...clone(baseline),structural_transfer:false,transfer_reason:"rule_missing"};
      return applyStructuralRule({...input,baseline},rule);
    }
  };
}

module.exports={
  learnStructuralTransferRules,
  createStructuralTransferPolicy,
  applyStructuralRule,
  inferTargetSourcePath,
  candidateContextPaths,
  getPath,
  targetFromDecision
};
