"use strict";

const crypto=require("crypto");
const path=require("path");
const {spawnSync}=require("child_process");
const {
  loadSceneContext,
  loadPinnedSceneContext,
  validateSceneContext,
  targetKey
}=require("./spatialruntime_world_context.cjs");

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
function isGitCommit(v){return /^[0-9a-f]{40}$/.test(String(v||""))}
function runtimeRegistrySnapshot(runtime){
  const devices=runtime&&runtime.devices||{};
  if(!devices||typeof devices!=="object"||Array.isArray(devices)){
    throw new Error("spatialruntime_registry_devices_invalid");
  }
  const out={};
  for(const key of Object.keys(devices).sort()){
    const device=devices[key]||{};
    const modelId=String(device.model_id||"");
    if(!modelId)throw new Error("spatialruntime_registry_model_id_required:"+key);
    out[key]={model_id:modelId};
  }
  return out;
}
function runtimeRegistryDigest(runtime){
  return sha256Object(runtimeRegistrySnapshot(runtime));
}
function patchIdentity(p){
  return {
    op:p&&p.op||null,
    target:clone(p&&p.target||null),
    slot:p&&p.slot||null
  };
}
function sameObject(a,b){
  return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
}
function samePatchIdentity(a,b){
  return sameObject(patchIdentity(a),patchIdentity(b));
}

function validateAuthorizationReceipt(receipt,request,requestedPatches){
  if(!receipt||receipt.schema!==RECEIPT_SCHEMA){
    throw new Error("spatialruntime_authorizer_invalid_receipt");
  }
  if(receipt.allow!==true){
    throw new Error("spatialruntime_authorizer_receipt_not_allowed");
  }
  if(receipt.canonicalization!=="sorted-json-number-normalized-v1"){
    throw new Error("spatialruntime_authorizer_canonicalization_mismatch");
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
  if(request.spatialruntime_commit_sha!=null){
    if(!isGitCommit(request.spatialruntime_commit_sha)){
      throw new Error("spatialruntime_authorizer_request_commit_invalid");
    }
    if(receipt.spatialruntime_commit_sha!==request.spatialruntime_commit_sha){
      throw new Error("spatialruntime_authorizer_commit_mismatch");
    }
  }else if(receipt.spatialruntime_commit_sha!=null){
    throw new Error("spatialruntime_authorizer_unrequested_commit");
  }
  if(!isSha256(request.registry_digest)){
    throw new Error("spatialruntime_authorizer_request_registry_digest_invalid");
  }
  if(!isSha256(receipt.registry_digest)||receipt.registry_digest!==request.registry_digest){
    throw new Error("spatialruntime_authorizer_registry_digest_mismatch");
  }
  if(receipt.single_use!==true){
    throw new Error("spatialruntime_authorizer_single_use_required");
  }
  if(typeof receipt.authorization_id!=="string"||!receipt.authorization_id){
    throw new Error("spatialruntime_authorizer_authorization_id_required");
  }
  const requestedScene=request&&request.spatial_context&&request.spatial_context.scene_evidence;
  if(requestedScene){
    if(!receipt.scene_evidence||!sameObject(receipt.scene_evidence,requestedScene)){
      throw new Error("spatialruntime_authorizer_scene_evidence_mismatch");
    }
  }else if(receipt.scene_evidence!=null){
    throw new Error("spatialruntime_authorizer_unrequested_scene_evidence");
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
  if(Number(receipt.requested_patch_count)!==requestedPatches.length){
    throw new Error("spatialruntime_authorizer_requested_patch_count_mismatch");
  }
  if(!Array.isArray(receipt.authorized_patches)||receipt.authorized_patches.length!==requestedPatches.length){
    throw new Error("spatialruntime_authorizer_patch_count_mismatch");
  }
  if(!isSha256(receipt.patch_digest)||
     receipt.patch_digest!==sha256Object(receipt.authorized_patches)){
    throw new Error("spatialruntime_authorizer_patch_digest_mismatch");
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
  const spatialRuntimeCommitSha=options.spatialRuntimeCommitSha||
    process.env.SPATIALRUNTIME_COMMIT_SHA||null;
  if(spatialRuntimeCommitSha!=null&&!isGitCommit(spatialRuntimeCommitSha)){
    throw new Error("spatialruntime_authorizer_configured_commit_invalid");
  }
  const hasScenePath=!!(
    options.worldSnapshotPath||
    options.worldValidationReceiptPath||
    options.worldHandoffPath
  );
  if(hasScenePath&&!(options.worldSnapshotPath&&options.worldValidationReceiptPath)){
    throw new Error("spatialruntime_scene_world_and_receipt_required");
  }
  if(options.worldHandoffPath&&!(options.worldSnapshotPath&&options.worldValidationReceiptPath)){
    throw new Error("spatialruntime_scene_handoff_requires_world_and_receipt");
  }
  const configuredSceneSources=[
    options.sceneContext?1:0,
    options.sceneContextPath?1:0,
    hasScenePath?1:0
  ].reduce((a,b)=>a+b,0);
  if(configuredSceneSources>1){
    throw new Error("spatialruntime_scene_context_sources_are_mutually_exclusive");
  }
  const sceneContext=options.sceneContext
    ?validateSceneContext(options.sceneContext)
    :(options.sceneContextPath
      ?loadPinnedSceneContext(options.sceneContextPath)
      :(hasScenePath
        ?loadSceneContext(
          options.worldSnapshotPath,
          options.worldValidationReceiptPath,
          {
            windowEntityLabel:options.windowEntityLabel||"窗",
            handoffPath:options.worldHandoffPath||null,
            expectedSourceRepo:options.expectedSceneSourceRepo||null,
            expectedSourceCommit:options.expectedSceneSourceCommit||null
          }
        )
        :null));
  if(
    sceneContext&&sceneContext.spatialruntime_commit_sha!=null&&
    spatialRuntimeCommitSha!=null&&
    sceneContext.spatialruntime_commit_sha!==spatialRuntimeCommitSha
  ){
    throw new Error("spatialruntime_scene_runtime_commit_mismatch");
  }
  return async function authorize({runtime,patches,event,context,source_step,source_revision}={}){
    const requestedPatches=clone(patches||[]);
    const hint=(event&&event.context_hint&&event.context_hint.spatialruntime)||{};
    const hintedKeys=Array.isArray(hint.exterior_window_keys)
      ?hint.exterior_window_keys.map(String)
      :[];
    if(sceneContext){
      const reviewed=new Set(sceneContext.exterior_window_keys||[]);
      for(const key of hintedKeys){
        if(!reviewed.has(key)){
          throw new Error("spatialruntime_scene_hint_not_reviewed:"+key);
        }
      }
      for(const patch of requestedPatches){
        if(!patch||!patch.target||!reviewed.has(targetKey(patch.target))){
          throw new Error(
            "spatialruntime_scene_target_not_reviewed:"+
            targetKey(patch&&patch.target||{})
          );
        }
      }
    }
    const spatialContext={
      rain:hint.rain ?? context?.rain ?? context?.sensors?.rain?.value ?? "dry",
      exterior_window_keys:sceneContext
        ?clone(sceneContext.exterior_window_keys||[])
        :(hintedKeys.length
          ?hintedKeys
          :(Array.isArray(options.exteriorWindowKeys)?options.exteriorWindowKeys:[])),
      scene_evidence:sceneContext?clone(sceneContext):null
    };
    const request={
      schema:REQUEST_SCHEMA,
      case_id:String(event?.turn_id||options.caseId||"homeai-windowpilot"),
      source_step:Number.isInteger(source_step)&&source_step>=0?source_step:0,
      source_revision:Number.isInteger(source_revision)&&source_revision>=0?source_revision:0,
      spatialruntime_commit_sha:spatialRuntimeCommitSha,
      runtime:clone(runtime||{}),
      registry_digest:runtimeRegistryDigest(runtime||{}),
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
  sameObject,
  runtimeRegistrySnapshot,
  runtimeRegistryDigest,
  samePatchIdentity,
  validateAuthorizationReceipt,
  createSpatialRuntimeAuthorizer
};
