"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function canonical(v){
  if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
  if(v&&typeof v==="object"){
    return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  }
  return JSON.stringify(v);
}

function contextKey(context){
  return canonical(context||{});
}

function buildReplayPolicyMemory(preferenceDataset){
  if(!preferenceDataset||preferenceDataset.schema_version!=="pi-home-preference-dataset-v1"){
    throw new Error("unsupported_preference_dataset");
  }
  const memory=new Map();
  for(const pair of preferenceDataset.pairs||[]){
    if(!pair.context)continue;
    memory.set(contextKey(pair.context),{
      id:pair.id,
      chosen:clone(pair.chosen),
      rejected:clone(pair.rejected),
      evidence:clone(pair.evidence||null),
      rationale:pair.rationale||null
    });
  }
  return memory;
}

function createReplayConditionedPolicy({baselinePredict,preferenceDataset}={}){
  if(typeof baselinePredict!=="function")throw new Error("baseline_predict_required");
  const memory=buildReplayPolicyMemory(preferenceDataset);
  const predict=async(input={})=>{
    const baseline=await baselinePredict(input);
    const hit=memory.get(contextKey(input.replay_context||input.context||{}));
    if(!hit){
      return {
        ...clone(baseline),
        replay_conditioned:false,
        replay_evidence:null
      };
    }
    return {
      ...clone(hit.chosen),
      replay_conditioned:true,
      baseline_prediction:clone(baseline),
      replay_evidence:{
        pair_id:hit.id,
        rationale:hit.rationale,
        evidence:clone(hit.evidence)
      }
    };
  };
  return {predict,memory_size:memory.size};
}

module.exports={canonical,contextKey,buildReplayPolicyMemory,createReplayConditionedPolicy};
