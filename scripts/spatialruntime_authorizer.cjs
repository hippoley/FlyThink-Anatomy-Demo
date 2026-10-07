"use strict";

const crypto=require("crypto");
const path=require("path");
const {spawnSync}=require("child_process");

const REQUEST_SCHEMA="homeai_spatialruntime_authorization_request_v1";
const RECEIPT_SCHEMA="homeai_spatialruntime_authorization_receipt_v1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function canonical(v){
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==="object"){
    const out={};
    for(const k of Object.keys(v).sort())out[k]=canonical(v[k]);
    return out;
  }
  return v;
}
function sha256Object(v){
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
}
function isSha256(v){return /^[0-9a-f]{64}$/.test(String(v||""))}
function patchIdentity(p){
  return {
    op:p&&p.op||null,
    target:clone(p&&p.target||null),
    slot:p&&p.slot||null
  };
}
function samePatchIdentity(a,b){
  return JSON.stringify(canonical(patchIdentity(a)))===JSON.stringify(canonical(patchIdentity(b)));
}

function validateAuthorizationReceipt(receipt,request,requestedPatches){
  if(!receipt||receipt.schema!==RECEIPT_SCHEMA){
    throw new Error("spatialruntime_authorizer_invalid_receipt");
  }
  if(receipt.allow!==true){
    throw new Error("spatialruntime_authorizer_receipt_not_allowed");
  }
  if(receipt.case_id!==request.case_id){
    throw new Error("spatialruntime_authorizer_case_id_mismatch");
  }
  if(Number(receipt.source_step)!==Number(request.source_step)){
    throw new Error("spatialruntime_authorizer_source_step_mismatch");
  }
  if(Number(receipt.source_revision)!==Number(request.source_revision)){
    throw new Error("spatialruntime_authorizer_source_revision_mismatch");
  }
  if(!isSha256(receipt.trace_hash)){
    throw new Error("spatialruntime_authorizer_trace_hash_invalid");
  }
  if(!isSha256(receipt.receipt_sha256)){
    throw new Error("spatialruntime_authorizer_receipt_sha256_invalid");
  }
  const base=clone(receipt);
  delete base.receipt_sha256;
  if(sha256Object(base)!==receipt.receipt_sha256){
    throw new Error("spatialruntime_authorizer_receipt_sha256_mismatch");
  }
  if(!Array.isArray(receipt.authorized_patches)||receipt.authorized_patches.length!==requestedPatches.length){
    throw new Error("spatialruntime_authorizer_patch_count_mismatch");
  }
  for(let i=0;i<requestedPatches.length;i++){
    const requested=requestedPatches[i];
    const authorized=receipt.authorized_patches[i];
    if(!samePatchIdentity(requested,authorized)){
      throw new Error("spatialruntime_authorizer_patch_identity_mismatch:"+String(i));
    }
    const value=Number(authorized&&authorized.value);
    if(!Number.isFinite(value)||value<0||value>100){
      throw new Error("spatialruntime_authorizer_patch_value_invalid:"+String(i));
    }
  }
  return {
    allow:true,
    patches:clone(receipt.authorized_patches),
    receipt:clone(receipt),
    integrity:{
      receipt_sha256:receipt.receipt_sha256,
      trace_hash:receipt.trace_hash,
      patch_count:receipt.authorized_patches.length
    }
  };
}

function createSpatialRuntimeAuthorizer(options={}){
  const python=options.python||process.env.PYTHON||"python";
  const script=options.script||path.join(__dirname,"spatialruntime_window_authorizer.py");
  const maxOpenRatioDelta=options.maxOpenRatioDelta==null?0.25:Number(options.maxOpenRatioDelta);
  return async function authorize({runtime,patches,event,context,source_step,source_revision}={}){
    const requestedPatches=clone(patches||[]);
    const hint=(event&&event.context_hint&&event.context_hint.spatialruntime)||{};
    const spatialContext={
      rain:hint.rain ?? context?.rain ?? context?.sensors?.rain?.value ?? "dry",
      exterior_window_keys:Array.isArray(hint.exterior_window_keys)
        ?hint.exterior_window_keys
        :(Array.isArray(options.exteriorWindowKeys)?options.exteriorWindowKeys:[])
    };
    const request={
      schema:REQUEST_SCHEMA,
      case_id:String(event?.turn_id||options.caseId||"homeai-windowpilot"),
      source_step:Number.isInteger(source_step)&&source_step>=0?source_step:0,
      source_revision:Number.isInteger(source_revision)&&source_revision>=0?source_revision:0,
      runtime:clone(runtime||{}),
      patches:requestedPatches,
      spatial_context:spatialContext,
      max_open_ratio_delta:maxOpenRatioDelta
    };
    const proc=spawnSync(python,[script],{
      input:JSON.stringify(request),
      encoding:"utf8",
      windowsHide:true,
      timeout:Number(options.timeoutMs||5000),
      env:process.env
    });
    if(proc.error){
      throw new Error("spatialruntime_authorizer_process_error:"+String(proc.error.message||proc.error));
    }
    let receipt=null;
    try{receipt=JSON.parse(String(proc.stdout||"").trim())}
    catch(e){
      throw new Error("spatialruntime_authorizer_invalid_json");
    }
    if(!receipt||receipt.schema!==RECEIPT_SCHEMA){
      throw new Error("spatialruntime_authorizer_invalid_receipt");
    }
    if(proc.status!==0||receipt.allow!==true){
      const reason=receipt.error||receipt.trace_status||"blocked";
      const err=new Error("spatialruntime_authorization_blocked:"+reason);
      err.receipt=receipt;
      throw err;
    }
    return validateAuthorizationReceipt(receipt,request,requestedPatches);
  };
}

module.exports={
  REQUEST_SCHEMA,
  RECEIPT_SCHEMA,
  canonical,
  sha256Object,
  patchIdentity,
  samePatchIdentity,
  validateAuthorizationReceipt,
  createSpatialRuntimeAuthorizer
};
