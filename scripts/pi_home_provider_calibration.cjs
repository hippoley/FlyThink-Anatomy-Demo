"use strict";

const crypto=require("crypto");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function requireText(value,name){
  if(typeof value!=="string"||!value.trim())throw new Error(name+"_required");
  return value.trim();
}
function canonical(v){
  if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
  if(v&&typeof v==="object"){
    return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
  }
  return JSON.stringify(v);
}
function sha256(value){
  return "sha256:"+crypto.createHash("sha256").update(value).digest("hex");
}
function canonicalDigest(value){return sha256(canonical(value))}

function normalizeDirection(value){
  const direction=String(value||"min");
  if(!["min","max"].includes(direction))throw new Error("calibration_direction_invalid");
  return direction;
}

function normalizeCalibrationDataset(dataset={}){
  if(dataset.schema_version!=="pi-home-provider-calibration-dataset-v1"){
    throw new Error("unsupported_calibration_dataset_schema");
  }
  const provider_id=requireText(dataset.provider_id,"calibration_provider_id");
  const dimension=requireText(dataset.dimension,"calibration_dimension");
  const scope_id=requireText(dataset.scope_id,"calibration_scope_id");
  const source_kind=requireText(dataset.source_kind,"calibration_source_kind");
  const direction=normalizeDirection(dataset.direction);
  const rows=Array.isArray(dataset.rows)?dataset.rows:[];
  if(!rows.length)throw new Error("calibration_rows_required");

  const ids=new Set();
  const normalizedRows=rows.map((row,rowIndex)=>{
    const case_id=requireText(row.case_id,"calibration_case_id");
    if(ids.has(case_id))throw new Error("duplicate_calibration_case_id:"+case_id);
    ids.add(case_id);
    const candidates=Array.isArray(row.candidates)?row.candidates:[];
    if(candidates.length<2)throw new Error("calibration_case_requires_two_candidates:"+case_id);
    const labels=new Set();
    const normalizedCandidates=candidates.map((candidate,index)=>{
      const label=requireText(candidate.label,"calibration_candidate_label");
      if(labels.has(label))throw new Error("duplicate_calibration_candidate_label:"+case_id+":"+label);
      labels.add(label);
      const predicted=Number(candidate.predicted);
      const observed=Number(candidate.observed);
      if(!Number.isFinite(predicted))throw new Error("calibration_predicted_value_invalid:"+case_id+":"+index);
      if(!Number.isFinite(observed))throw new Error("calibration_observed_value_invalid:"+case_id+":"+index);
      return {label,predicted,observed};
    });
    return {
      case_id,
      candidates:normalizedCandidates,
      metadata:clone(row.metadata||null)
    };
  });

  return {
    schema_version:"pi-home-provider-calibration-dataset-v1",
    provider_id,
    dimension,
    scope_id,
    source_kind,
    direction,
    fixture_only:dataset.fixture_only===true,
    measurement_provenance:clone(dataset.measurement_provenance||null),
    rows:normalizedRows
  };
}

function better(a,b,direction){
  if(a===b)return 0;
  return direction==="min"?(a<b?1:-1):(a>b?1:-1);
}
function winner(candidates,key,direction){
  return [...candidates].sort((a,b)=>{
    const av=a[key],bv=b[key];
    if(av===bv)return a.label.localeCompare(b.label);
    return direction==="min"?av-bv:bv-av;
  })[0].label;
}

function evaluateProviderCalibration(dataset={},{
  min_cases=10,
  min_pairwise_comparisons=20,
  min_pairwise_accuracy=.9,
  min_top1_accuracy=.9
}={}){
  const d=normalizeCalibrationDataset(dataset);
  let pairwise=0,pairwiseCorrect=0,top1Correct=0;
  const rows=[];

  for(const row of d.rows){
    const predictedWinner=winner(row.candidates,"predicted",d.direction);
    const observedWinner=winner(row.candidates,"observed",d.direction);
    const top1=predictedWinner===observedWinner;
    if(top1)top1Correct++;

    let casePairs=0,caseCorrect=0;
    for(let i=0;i<row.candidates.length;i++){
      for(let j=i+1;j<row.candidates.length;j++){
        const a=row.candidates[i],b=row.candidates[j];
        const p=better(a.predicted,b.predicted,d.direction);
        const o=better(a.observed,b.observed,d.direction);
        if(p===0||o===0)continue;
        casePairs++;pairwise++;
        if(p===o){caseCorrect++;pairwiseCorrect++}
      }
    }
    rows.push({
      case_id:row.case_id,
      predicted_winner:predictedWinner,
      observed_winner:observedWinner,
      top1_correct:top1,
      pairwise_comparisons:casePairs,
      pairwise_correct:caseCorrect
    });
  }

  const top1Accuracy=d.rows.length?top1Correct/d.rows.length:0;
  const pairwiseAccuracy=pairwise?pairwiseCorrect/pairwise:0;
  const sourceEligible=d.source_kind==="measured"&&d.fixture_only!==true;
  const provenancePresent=!!(
    d.measurement_provenance &&
    typeof d.measurement_provenance==="object" &&
    d.measurement_provenance.dataset_id &&
    d.measurement_provenance.collected_by
  );
  const thresholds={
    min_cases:Number(min_cases),
    min_pairwise_comparisons:Number(min_pairwise_comparisons),
    min_pairwise_accuracy:Number(min_pairwise_accuracy),
    min_top1_accuracy:Number(min_top1_accuracy)
  };
  const metrics={
    cases:d.rows.length,
    top1_correct:top1Correct,
    top1_accuracy:Number(top1Accuracy.toFixed(6)),
    pairwise_comparisons:pairwise,
    pairwise_correct:pairwiseCorrect,
    pairwise_accuracy:Number(pairwiseAccuracy.toFixed(6))
  };
  const failures=[];
  if(!sourceEligible)failures.push("measured_non_fixture_source_required");
  if(!provenancePresent)failures.push("measurement_provenance_required");
  if(metrics.cases<thresholds.min_cases)failures.push("insufficient_cases");
  if(metrics.pairwise_comparisons<thresholds.min_pairwise_comparisons)failures.push("insufficient_pairwise_comparisons");
  if(metrics.pairwise_accuracy<thresholds.min_pairwise_accuracy)failures.push("pairwise_accuracy_below_threshold");
  if(metrics.top1_accuracy<thresholds.min_top1_accuracy)failures.push("top1_accuracy_below_threshold");

  const datasetFingerprint=canonicalDigest(d);
  const reportCore={
    schema_version:"pi-home-provider-calibration-report-v1",
    provider_id:d.provider_id,
    dimension:d.dimension,
    scope_id:d.scope_id,
    source_kind:d.source_kind,
    direction:d.direction,
    fixture_only:d.fixture_only,
    measurement_provenance:clone(d.measurement_provenance),
    dataset_fingerprint:datasetFingerprint,
    thresholds,
    metrics,
    rows,
    eligible_for_registry:failures.length===0,
    failures
  };
  return {
    ...reportCore,
    report_digest:canonicalDigest(reportCore)
  };
}

function buildTrustRegistryEntryFromCalibration(report={},{
  calibration_ref,
  approved_by,
  evidence_levels=["engineering-validated"]
}={}){
  if(report.schema_version!=="pi-home-provider-calibration-report-v1"){
    throw new Error("provider_calibration_report_required");
  }
  if(report.eligible_for_registry!==true){
    throw new Error("provider_calibration_not_eligible");
  }
  const ref=requireText(calibration_ref,"calibration_ref");
  const approver=requireText(approved_by,"provider_trust_approved_by");
  if(!/^sha256:[0-9a-f]{64}$/.test(String(report.report_digest||""))){
    throw new Error("provider_calibration_report_digest_invalid");
  }
  return {
    provider_id:requireText(report.provider_id,"provider_id"),
    status:"active",
    scope_id:requireText(report.scope_id,"provider_trust_scope_id"),
    allowed_dimensions:[requireText(report.dimension,"provider_dimension")],
    allowed_evidence_levels:(evidence_levels||[]).map(String),
    calibration_ref:ref,
    calibration_digest:report.report_digest,
    approved_by:approver,
    metadata:{
      calibration_dataset_fingerprint:report.dataset_fingerprint,
      calibration_metrics:clone(report.metrics),
      calibration_thresholds:clone(report.thresholds)
    }
  };
}

function buildTrustAttestationFromCalibration(report={},{
  calibration_ref
}={}){
  if(report.schema_version!=="pi-home-provider-calibration-report-v1"){
    throw new Error("provider_calibration_report_required");
  }
  if(report.eligible_for_registry!==true){
    throw new Error("provider_calibration_not_eligible");
  }
  return {
    scope_id:requireText(report.scope_id,"provider_trust_scope_id"),
    calibration_ref:requireText(calibration_ref,"calibration_ref"),
    calibration_digest:report.report_digest
  };
}

module.exports={
  canonical,
  canonicalDigest,
  normalizeCalibrationDataset,
  evaluateProviderCalibration,
  buildTrustRegistryEntryFromCalibration,
  buildTrustAttestationFromCalibration
};
