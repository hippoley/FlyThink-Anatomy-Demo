"use strict";

const path=require("path");
const {spawnSync}=require("child_process");

const REQUEST_SCHEMA="homeai_spatialruntime_authorization_request_v1";
const RECEIPT_SCHEMA="homeai_spatialruntime_authorization_receipt_v1";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function createSpatialRuntimeAuthorizer(options={}){
  const python=options.python||process.env.PYTHON||"python";
  const script=options.script||path.join(__dirname,"spatialruntime_window_authorizer.py");
  const maxOpenRatioDelta=options.maxOpenRatioDelta==null?0.25:Number(options.maxOpenRatioDelta);
  return async function authorize({runtime,patches,event,context,source_step,source_revision}={}){
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
      patches:clone(patches||[]),
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
    let receipt=null;
    try{receipt=JSON.parse(String(proc.stdout||"").trim())}
    catch(e){
      throw new Error("spatialruntime_authorizer_invalid_json");
    }
    if(!receipt||receipt.schema!==RECEIPT_SCHEMA){
      throw new Error("spatialruntime_authorizer_invalid_receipt");
    }
    if(proc.error){
      throw new Error("spatialruntime_authorizer_process_error:"+String(proc.error.message||proc.error));
    }
    if(proc.status!==0||receipt.allow!==true){
      const reason=receipt.error||receipt.trace_status||"blocked";
      const err=new Error("spatialruntime_authorization_blocked:"+reason);
      err.receipt=receipt;
      throw err;
    }
    if(!Array.isArray(receipt.authorized_patches)||receipt.authorized_patches.length!==patches.length){
      throw new Error("spatialruntime_authorizer_patch_count_mismatch");
    }
    return {allow:true,patches:receipt.authorized_patches,receipt};
  };
}

module.exports={
  REQUEST_SCHEMA,
  RECEIPT_SCHEMA,
  createSpatialRuntimeAuthorizer
};
