"use strict";

const crypto=require("crypto");
const {buildProviderTrustRegistry}=require("./pi_home_provider_trust.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function uniq(xs){return [...new Set((xs||[]).map(String))].sort()}

function canonical(value){
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value&&typeof value==="object"){
    return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
  }
  return JSON.stringify(value);
}

function sha256(value){
  return "sha256:"+crypto.createHash("sha256").update(
    typeof value==="string"?value:canonical(value)
  ).digest("hex");
}

function requireText(value,name){
  if(typeof value!=="string"||!value.trim())throw new Error(name+"_required");
  return value.trim();
}

function validateDataset(dataset={}){
  if(dataset.schema_version!=="pi-home-provider-calibration-dataset-v1"){
    throw new Error("unsupported_calibration_dataset_schema");
  }
  const provider_id=requireText(dataset.provider_id,"provider_id");
  const scope_id=requireText(dataset.scope_id,"scope_id");
  const evidence_level=requireText(dataset.evidence_level,"evidence_level");
  const source_kind=requireText(dataset.source_kind,"source_kind");
  const samples=Array.isArray(dataset.samples)?dataset.samples:[];
  if(!samples.length)throw new Error("calibration_samples_required");

  const seenIds=new Set();
  const seenRefs=new Set();
  const normalized=samples.map((sample,index)=>{
    const id=requireText(sample.id,"sample_id");
    if(seenIds.has(id))throw new Error("duplicate_calibration_sample_id:"+id);
    seenIds.add(id);
    const measurement_ref=requireText(sample.measurement_ref,"measurement_ref");
    if(seenRefs.has(measurement_ref))throw new Error("duplicate_measurement_ref:"+measurement_ref);
    seenRefs.add(measurement_ref);
    const dimension=requireText(sample.dimension,"dimension");
    const predicted=Number(sample.predicted);
    const observed=Number(sample.observed);
    if(!Number.isFinite(predicted)||!Number.isFinite(observed)){
      throw new Error("calibration_sample_must_be_numeric:"+String(index));
    }
    return {id,measurement_ref,dimension,predicted,observed};
  });
  return {
    schema_version:dataset.schema_version,
    provider_id,
    scope_id,
    evidence_level,
    source_kind,
    samples:normalized,
    metadata:clone(dataset.metadata||null)
  };
}

function metricsFor(samples=[]){
  if(!samples.length)return null;
  const errors=samples.map(x=>x.predicted-x.observed);
  const abs=errors.map(Math.abs);
  const mse=errors.reduce((a,e)=>a+e*e,0)/errors.length;
  return {
    samples:samples.length,
    mae:Number((abs.reduce((a,b)=>a+b,0)/abs.length).toFixed(6)),
    rmse:Number(Math.sqrt(mse).toFixed(6)),
    max_abs_error:Number(Math.max(...abs).toFixed(6)),
    bias:Number((errors.reduce((a,b)=>a+b,0)/errors.length).toFixed(6))
  };
}

function normalizeThresholds(thresholds={}){
  const out={};
  for(const [dimension,spec] of Object.entries(thresholds||{})){
    const min_samples=Number(spec.min_samples??20);
    const max_mae=Number(spec.max_mae);
    const max_rmse=Number(spec.max_rmse);
    const max_abs_error=Number(spec.max_abs_error);
    if(!Number.isInteger(min_samples)||min_samples<1)throw new Error("invalid_min_samples:"+dimension);
    for(const [name,value] of Object.entries({max_mae,max_rmse,max_abs_error})){
      if(!Number.isFinite(value)||value<0)throw new Error("invalid_"+name+":"+dimension);
    }
    out[String(dimension)]={min_samples,max_mae,max_rmse,max_abs_error};
  }
  if(!Object.keys(out).length)throw new Error("calibration_thresholds_required");
  return out;
}

function evaluateCalibrationDataset(dataset,{
  thresholds={},
  required_source_kind="measured"
}={}){
  const data=validateDataset(dataset);
  const limits=normalizeThresholds(thresholds);
  const dimensions=uniq(data.samples.map(x=>x.dimension));
  const missingThresholds=dimensions.filter(d=>!limits[d]);
  const extraThresholds=Object.keys(limits).filter(d=>!dimensions.includes(d));
  if(missingThresholds.length)throw new Error("calibration_threshold_missing:"+missingThresholds.join(","));

  const byDimension={};
  for(const dimension of dimensions){
    const rows=data.samples.filter(x=>x.dimension===dimension);
    const metrics=metricsFor(rows);
    const t=limits[dimension];
    const passed=
      metrics.samples>=t.min_samples &&
      metrics.mae<=t.max_mae &&
      metrics.rmse<=t.max_rmse &&
      metrics.max_abs_error<=t.max_abs_error;
    byDimension[dimension]={metrics,thresholds:t,passed};
  }

  const sourceTrusted=data.source_kind===required_source_kind;
  const dimensionsPassed=dimensions.every(d=>byDimension[d].passed);
  const passed=sourceTrusted&&dimensionsPassed&&extraThresholds.length===0;
  const datasetDigest=sha256(data);
  const certificateCore={
    schema_version:"pi-home-provider-calibration-certificate-v1",
    provider_id:data.provider_id,
    scope_id:data.scope_id,
    evidence_level:data.evidence_level,
    covered_dimensions:dimensions,
    source_kind:data.source_kind,
    source_kind_required:required_source_kind,
    source_kind_accepted:sourceTrusted,
    by_dimension:byDimension,
    dataset_digest:datasetDigest,
    calibration_ref:"calibration://"+data.provider_id+"/"+datasetDigest.slice("sha256:".length, "sha256:".length+16),
    passed
  };
  return {
    ...certificateCore,
    calibration_digest:sha256(certificateCore)
  };
}

function registryEntryFromCertificate(certificate,{approved_by,status="active"}={}){
  if(!certificate||certificate.schema_version!=="pi-home-provider-calibration-certificate-v1"){
    throw new Error("calibration_certificate_required");
  }
  if(certificate.passed!==true)throw new Error("calibration_certificate_not_passed");
  const approver=requireText(approved_by,"approved_by");
  if(status!=="active")throw new Error("new_registry_entry_must_be_active");
  return {
    provider_id:certificate.provider_id,
    status:"active",
    scope_id:certificate.scope_id,
    allowed_dimensions:clone(certificate.covered_dimensions),
    allowed_evidence_levels:[certificate.evidence_level],
    calibration_ref:certificate.calibration_ref,
    calibration_digest:certificate.calibration_digest,
    approved_by:approver,
    metadata:{
      certificate_schema:certificate.schema_version,
      dataset_digest:certificate.dataset_digest,
      source_kind:certificate.source_kind,
      by_dimension:clone(certificate.by_dimension)
    }
  };
}

function buildCertifiedProviderTrustRegistry(items=[]){
  const entries=[];
  const certificates=[];
  for(const item of items||[]){
    if(!item||!item.certificate)throw new Error("calibration_certificate_required");
    const entry=registryEntryFromCertificate(item.certificate,{approved_by:item.approved_by});
    entries.push(entry);
    certificates.push(item.certificate);
  }
  return buildProviderTrustRegistry(entries,{certificates});
}

module.exports={
  canonical,
  sha256,
  validateDataset,
  metricsFor,
  normalizeThresholds,
  evaluateCalibrationDataset,
  registryEntryFromCertificate,
  buildCertifiedProviderTrustRegistry
};
