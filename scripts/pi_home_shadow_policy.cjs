"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function canonical(v){
  if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
  if(v&&typeof v==="object"){
    return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  }
  return JSON.stringify(v);
}
function targetKey(t){
  return t&&[t.area,t.entity,t.instance||"default"].join("::");
}
function patchSignature(patches=[]){
  return (patches||[]).map(p=>({
    op:p&&p.op||null,
    target:targetKey(p&&p.target),
    targets:(p&&p.targets||[]).map(targetKey),
    slot:p&&p.slot||null,
    value:p&&p.value,
    delta:p&&p.delta
  }));
}
function comparePredictions(current={},shadow={}){
  const currentPatches=patchSignature(current.patches||[]);
  const shadowPatches=patchSignature(shadow.patches||[]);
  const decisionDisagreement=(current.decision||null)!==(shadow.decision||null);
  const patchDisagreement=canonical(currentPatches)!==canonical(shadowPatches);
  const currentTargets=new Set(currentPatches.flatMap(x=>[x.target,...x.targets]).filter(Boolean));
  const shadowTargets=new Set(shadowPatches.flatMap(x=>[x.target,...x.targets]).filter(Boolean));
  const targetDisagreement=canonical([...currentTargets].sort())!==canonical([...shadowTargets].sort());
  return {
    decision_disagreement:decisionDisagreement,
    target_disagreement:targetDisagreement,
    patch_disagreement:patchDisagreement,
    any_disagreement:decisionDisagreement||targetDisagreement||patchDisagreement,
    current_patch_signature:currentPatches,
    shadow_patch_signature:shadowPatches
  };
}

class ShadowPolicyMonitor{
  constructor({currentPredict,shadowPredict,advantageEstimator=null}={}){
    if(typeof currentPredict!=="function")throw new Error("current_predict_required");
    if(typeof shadowPredict!=="function")throw new Error("shadow_predict_required");
    this.currentPredict=currentPredict;
    this.shadowPredict=shadowPredict;
    this.advantageEstimator=advantageEstimator;
    this.records=[];
  }

  async predict(input={}){
    const [current,shadow]=await Promise.all([
      this.currentPredict(input),
      this.shadowPredict(input)
    ]);
    const comparison=comparePredictions(current||{},shadow||{});
    const predictedAdvantage=typeof this.advantageEstimator==="function"
      ?await this.advantageEstimator({
        input:clone(input),
        current:clone(current||{}),
        shadow:clone(shadow||{}),
        comparison:clone(comparison)
      })
      :null;
    const record={
      id:input.turn_id||("shadow-"+String(this.records.length+1)),
      input:clone(input),
      current:clone(current||{}),
      shadow:clone(shadow||{}),
      comparison,
      predicted_advantage:predictedAdvantage,
      actual_outcome:null
    };
    this.records.push(record);
    return {
      ...clone(current||{}),
      shadow_record_id:record.id,
      shadow_observation:{
        prediction:clone(shadow||{}),
        comparison:clone(comparison),
        predicted_advantage:clone(predictedAdvantage)
      }
    };
  }

  attachOutcome(recordId,outcome){
    const record=this.records.find(x=>x.id===recordId);
    if(!record)throw new Error("shadow_record_not_found:"+recordId);
    record.actual_outcome=clone(outcome);
    return clone(record);
  }

  report(){
    const rows=this.records;
    const withOutcome=rows.filter(x=>x.actual_outcome!=null);
    return {
      schema_version:"pi-home-shadow-report-v1",
      turns:rows.length,
      disagreements:rows.filter(x=>x.comparison.any_disagreement).length,
      decision_disagreements:rows.filter(x=>x.comparison.decision_disagreement).length,
      target_disagreements:rows.filter(x=>x.comparison.target_disagreement).length,
      patch_disagreements:rows.filter(x=>x.comparison.patch_disagreement).length,
      outcomes_attached:withOutcome.length,
      rows:clone(rows)
    };
  }
}

module.exports={ShadowPolicyMonitor,comparePredictions,patchSignature,canonical};
