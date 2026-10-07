"use strict";

const crypto=require("crypto");
const fs=require("fs");

const WORLD_SCHEMA="spatialruntime_world_snapshot_v1";
const VALIDATION_SCHEMA="interior_scene_spatialruntime_consumer_v1";
const CONTEXT_SCHEMA="homeai_spatialruntime_scene_context_v1";

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
function sameObject(a,b){
  return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
}
function targetKey(target){
  return [target.area,target.entity,target.instance||"default"].join("::");
}

function validateSceneContext(context){
  if(!context||context.schema!==CONTEXT_SCHEMA){
    throw new Error("spatialruntime_scene_context_schema_invalid");
  }
  for(const key of (
    ["world_snapshot_sha256","validation_receipt_sha256","source_fingerprint","relation_graph_fingerprint","context_sha256"]
  )){
    if(!isSha256(context[key])){
      throw new Error("spatialruntime_scene_context_sha_invalid:"+key);
    }
  }
  if(!Array.isArray(context.exterior_windows)||!Array.isArray(context.exterior_window_keys)){
    throw new Error("spatialruntime_scene_context_windows_invalid");
  }
  const keys=[];
  const seen=new Set();
  for(const row of context.exterior_windows){
    if(!row||!row.target){
      throw new Error("spatialruntime_scene_context_window_target_missing");
    }
    const key=targetKey(row.target);
    if(row.key!==key){
      throw new Error("spatialruntime_scene_context_window_key_mismatch:"+String(row.key));
    }
    if(seen.has(key)){
      throw new Error("spatialruntime_scene_context_window_ambiguous:"+key);
    }
    seen.add(key);
    keys.push(key);
    if(!row.world_entity_id||!row.room_entity_id){
      throw new Error("spatialruntime_scene_context_entity_binding_missing:"+key);
    }
  }
  keys.sort();
  const declared=[...context.exterior_window_keys].map(String).sort();
  if(!sameObject(keys,declared)){
    throw new Error("spatialruntime_scene_context_exterior_keys_mismatch");
  }
  const base=clone(context);
  const saved=base.context_sha256;
  delete base.context_sha256;
  if(saved!==sha256Object(base)){
    throw new Error("spatialruntime_scene_context_sha_mismatch");
  }
  return clone(context);
}

function loadPinnedSceneContext(contextPath){
  if(!contextPath)throw new Error("spatialruntime_scene_context_path_required");
  return validateSceneContext(JSON.parse(fs.readFileSync(contextPath,"utf8")));
}

function validateSceneArtifacts(world,receipt,{windowEntityLabel="窗"}={}){
  if(!world||world.schema!==WORLD_SCHEMA){
    throw new Error("spatialruntime_scene_world_schema_invalid");
  }
  if(!receipt||receipt.schema!==VALIDATION_SCHEMA||receipt.valid!==true){
    throw new Error("spatialruntime_scene_validation_receipt_invalid");
  }
  if(receipt.case_id!==world.case_id){
    throw new Error("spatialruntime_scene_case_id_mismatch");
  }
  if(receipt.source_fingerprint_verified!==true){
    throw new Error("spatialruntime_scene_source_fingerprint_not_verified");
  }
  if(!isSha256(receipt.world_snapshot_sha256)||
     receipt.world_snapshot_sha256!==sha256Object(world)){
    throw new Error("spatialruntime_scene_world_sha256_mismatch");
  }
  if(!isSha256(receipt.receipt_sha256)){
    throw new Error("spatialruntime_scene_receipt_sha256_invalid");
  }
  const receiptBase=clone(receipt);
  delete receiptBase.receipt_sha256;
  if(receipt.receipt_sha256!==sha256Object(receiptBase)){
    throw new Error("spatialruntime_scene_receipt_sha256_mismatch");
  }

  const facts=world.facts||{};
  if(receipt.source_fingerprint!==facts.source_fingerprint){
    throw new Error("spatialruntime_scene_source_fingerprint_mismatch");
  }
  if(!sameObject(receipt.source_files_sha256,facts.source_files_sha256)){
    throw new Error("spatialruntime_scene_source_file_digests_mismatch");
  }
  if(Number(receipt.source_file_count)!==Object.keys(facts.source_files_sha256||{}).length){
    throw new Error("spatialruntime_scene_source_file_count_mismatch");
  }

  const entities=world.entities||{};
  const relations=Array.isArray(world.relations)?world.relations:[];
  const explicitExterior=[];
  const seen=new Set();

  for(const [entityId,meta] of Object.entries(entities)){
    if(!meta||meta.kind!=="window"||meta.exterior!==true)continue;
    if(meta.evidence_status!=="explicit_source"){
      throw new Error("spatialruntime_scene_exterior_window_not_explicit:"+entityId);
    }
    const roomId=meta.room;
    const room=entities[roomId];
    if(!room||room.kind!=="room"||!String(room.name||"").trim()){
      throw new Error("spatialruntime_scene_window_room_binding_invalid:"+entityId);
    }
    const relation=relations.find(
      rel=>rel&&rel.src===entityId&&rel.rel==="belongs_to"&&rel.dst===roomId
    );
    if(!relation||relation.status!=="explicit_source"||Number(relation.confidence)!==1){
      throw new Error("spatialruntime_scene_window_room_relation_unreviewed:"+entityId);
    }
    const target={
      area:String(room.name),
      entity:String(windowEntityLabel),
      instance:"default"
    };
    const key=targetKey(target);
    if(seen.has(key)){
      throw new Error("spatialruntime_scene_homeai_target_ambiguous:"+key);
    }
    seen.add(key);
    explicitExterior.push({
      key,
      target,
      world_entity_id:entityId,
      room_entity_id:roomId,
      opening_id:meta.opening_id||null,
      source_id:meta.source_id||null
    });
  }
  if(!explicitExterior.length){
    throw new Error("spatialruntime_scene_has_no_explicit_exterior_windows");
  }
  explicitExterior.sort((a,b)=>a.key.localeCompare(b.key));

  const body={
    schema:CONTEXT_SCHEMA,
    case_id:world.case_id,
    world_snapshot_sha256:receipt.world_snapshot_sha256,
    validation_receipt_sha256:receipt.receipt_sha256,
    source_fingerprint:receipt.source_fingerprint,
    relation_graph_fingerprint:receipt.relation_graph_fingerprint,
    exterior_windows:explicitExterior,
    exterior_window_keys:explicitExterior.map(x=>x.key)
  };
  return validateSceneContext({...body,context_sha256:sha256Object(body)});
}

function loadSceneContext(worldPath,receiptPath,options={}){
  if(!worldPath||!receiptPath){
    throw new Error("spatialruntime_scene_world_and_receipt_required");
  }
  const world=JSON.parse(fs.readFileSync(worldPath,"utf8"));
  const receipt=JSON.parse(fs.readFileSync(receiptPath,"utf8"));
  return validateSceneArtifacts(world,receipt,options);
}

module.exports={
  WORLD_SCHEMA,
  VALIDATION_SCHEMA,
  CONTEXT_SCHEMA,
  canonical,
  sha256Object,
  targetKey,
  validateSceneContext,
  loadPinnedSceneContext,
  validateSceneArtifacts,
  loadSceneContext
};
