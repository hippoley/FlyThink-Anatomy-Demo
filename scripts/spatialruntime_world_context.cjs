"use strict";

const crypto=require("crypto");
const fs=require("fs");

const WORLD_SCHEMA="spatialruntime_world_snapshot_v1";
const VALIDATION_SCHEMA="interior_scene_spatialruntime_consumer_v1";
const HANDOFF_SCHEMA="interior_scene_downstream_handoff_v1";
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
function isGitCommit(v){return /^[0-9a-f]{40}$/.test(String(v||""))}
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
  if(
    context.world_snapshot_revision!=null&&(
      !Number.isInteger(context.world_snapshot_revision)||
      context.world_snapshot_revision<0
    )
  ){
    throw new Error("spatialruntime_scene_context_world_revision_invalid");
  }
  for(const key of (
    ["world_snapshot_sha256","validation_receipt_sha256","source_fingerprint","relation_graph_fingerprint","context_sha256"]
  )){
    if(!isSha256(context[key])){
      throw new Error("spatialruntime_scene_context_sha_invalid:"+key);
    }
  }
  if(context.spatialruntime_commit_sha!=null&&!isGitCommit(context.spatialruntime_commit_sha)){
    throw new Error("spatialruntime_scene_context_runtime_commit_invalid");
  }
  if(context.handoff_evidence!=null){
    const handoff=context.handoff_evidence;
    if(!handoff||handoff.schema!==HANDOFF_SCHEMA){
      throw new Error("spatialruntime_scene_context_handoff_schema_invalid");
    }
    if(!String(handoff.source_repo||"").trim()){
      throw new Error("spatialruntime_scene_context_handoff_source_repo_missing");
    }
    if(!isGitCommit(handoff.source_commit_sha)){
      throw new Error("spatialruntime_scene_context_handoff_commit_invalid");
    }
    for(const key of ["handoff_sha256","explicit_exterior_windows_sha256"]){
      if(!isSha256(handoff[key])){
        throw new Error("spatialruntime_scene_context_handoff_sha_invalid:"+key);
      }
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
    if(row.target_binding_source!=null&&!["explicit_scene","legacy_fallback"].includes(row.target_binding_source)){
      throw new Error("spatialruntime_scene_context_target_binding_source_invalid:"+key);
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
    const authored=meta.control_bindings&&meta.control_bindings.homeai;
    let target;
    let targetBindingSource;
    if(authored!=null){
      if(!authored||typeof authored!=="object"||Array.isArray(authored)){
        throw new Error("spatialruntime_scene_homeai_binding_invalid:"+entityId);
      }
      target={
        area:String(authored.area||"").trim(),
        entity:String(authored.entity||"").trim(),
        instance:String(authored.instance||"").trim()
      };
      if(!target.area||!target.entity||!target.instance){
        throw new Error("spatialruntime_scene_homeai_binding_incomplete:"+entityId);
      }
      if(target.area!==String(room.name)){
        throw new Error("spatialruntime_scene_homeai_binding_room_mismatch:"+entityId);
      }
      targetBindingSource="explicit_scene";
    }else{
      target={
        area:String(room.name),
        entity:String(windowEntityLabel),
        instance:"default"
      };
      targetBindingSource="legacy_fallback";
    }
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
      source_id:meta.source_id||null,
      target_binding_source:targetBindingSource
    });
  }
  if(!explicitExterior.length){
    throw new Error("spatialruntime_scene_has_no_explicit_exterior_windows");
  }
  explicitExterior.sort((a,b)=>a.key.localeCompare(b.key));

  if(!Number.isInteger(world.revision)||world.revision<0){
    throw new Error("spatialruntime_scene_world_revision_invalid");
  }
  const body={
    schema:CONTEXT_SCHEMA,
    case_id:world.case_id,
    world_snapshot_revision:world.revision,
    world_snapshot_sha256:receipt.world_snapshot_sha256,
    validation_receipt_sha256:receipt.receipt_sha256,
    source_fingerprint:receipt.source_fingerprint,
    relation_graph_fingerprint:receipt.relation_graph_fingerprint,
    spatialruntime_commit_sha:receipt.spatialruntime_commit_sha||null,
    exterior_windows:explicitExterior,
    exterior_window_keys:explicitExterior.map(x=>x.key)
  };
  return validateSceneContext({...body,context_sha256:sha256Object(body)});
}

function validateSceneHandoff(world,receipt,handoff,options={}){
  const context=validateSceneArtifacts(world,receipt,options);
  if(!handoff||handoff.schema!==HANDOFF_SCHEMA){
    throw new Error("spatialruntime_scene_handoff_schema_invalid");
  }
  const handoffBase=clone(handoff);
  const saved=handoffBase.handoff_sha256;
  delete handoffBase.handoff_sha256;
  if(!isSha256(saved)||saved!==sha256Object(handoffBase)){
    throw new Error("spatialruntime_scene_handoff_sha256_mismatch");
  }
  if(!isGitCommit(handoff.source_commit_sha)){
    throw new Error("spatialruntime_scene_handoff_commit_invalid");
  }
  if(options.expectedSourceRepo&&handoff.source_repo!==options.expectedSourceRepo){
    throw new Error("spatialruntime_scene_handoff_source_repo_mismatch");
  }
  if(options.expectedSourceCommit&&handoff.source_commit_sha!==options.expectedSourceCommit){
    throw new Error("spatialruntime_scene_handoff_source_commit_mismatch");
  }
  if(handoff.case_id!==context.case_id){
    throw new Error("spatialruntime_scene_handoff_case_id_mismatch");
  }
  if(handoff.world_snapshot_sha256!==context.world_snapshot_sha256){
    throw new Error("spatialruntime_scene_handoff_world_sha256_mismatch");
  }
  if(handoff.validation_receipt_sha256!==context.validation_receipt_sha256){
    throw new Error("spatialruntime_scene_handoff_receipt_sha256_mismatch");
  }
  if(handoff.source_fingerprint!==context.source_fingerprint){
    throw new Error("spatialruntime_scene_handoff_source_fingerprint_mismatch");
  }
  if(handoff.relation_graph_fingerprint!==context.relation_graph_fingerprint){
    throw new Error("spatialruntime_scene_handoff_relation_graph_mismatch");
  }
  if((handoff.spatialruntime_commit_sha||null)!==(context.spatialruntime_commit_sha||null)){
    throw new Error("spatialruntime_scene_handoff_runtime_commit_mismatch");
  }
  if(!sameObject(handoff.source_files_sha256,receipt.source_files_sha256)){
    throw new Error("spatialruntime_scene_handoff_source_files_mismatch");
  }
  const contracts=Array.isArray(handoff.consumer_contracts)?handoff.consumer_contracts:[];
  if(!contracts.includes(CONTEXT_SCHEMA)){
    throw new Error("spatialruntime_scene_handoff_consumer_contract_missing");
  }

  const handoffRows=Array.isArray(handoff.explicit_exterior_windows)
    ?handoff.explicit_exterior_windows:[];
  if(handoffRows.length!==context.exterior_windows.length){
    throw new Error("spatialruntime_scene_handoff_window_count_mismatch");
  }
  const byKey=new Map(context.exterior_windows.map(row=>[row.key,row]));
  const seen=new Set();
  for(const row of handoffRows){
    if(!row||!row.target_key||!row.suggested_homeai_target){
      throw new Error("spatialruntime_scene_handoff_window_mapping_invalid");
    }
    if(seen.has(row.target_key)){
      throw new Error("spatialruntime_scene_handoff_window_ambiguous:"+row.target_key);
    }
    seen.add(row.target_key);
    const expected=byKey.get(row.target_key);
    if(!expected){
      throw new Error("spatialruntime_scene_handoff_target_not_in_context:"+row.target_key);
    }
    if(!sameObject(row.suggested_homeai_target,expected.target)){
      throw new Error("spatialruntime_scene_handoff_target_mapping_mismatch:"+row.target_key);
    }
    if(row.target_binding_source!=null&&row.target_binding_source!==expected.target_binding_source){
      throw new Error("spatialruntime_scene_handoff_target_binding_source_mismatch:"+row.target_key);
    }
    if(row.world_entity_id!==expected.world_entity_id||
       row.room_entity_id!==expected.room_entity_id||
       (row.opening_id||null)!==(expected.opening_id||null)){
      throw new Error("spatialruntime_scene_handoff_entity_binding_mismatch:"+row.target_key);
    }
  }

  const body=clone(context);
  delete body.context_sha256;
  body.handoff_evidence={
    schema:HANDOFF_SCHEMA,
    source_repo:handoff.source_repo,
    source_commit_sha:handoff.source_commit_sha,
    spatialruntime_commit_sha:handoff.spatialruntime_commit_sha||null,
    handoff_sha256:handoff.handoff_sha256,
    explicit_exterior_windows_sha256:sha256Object(handoffRows)
  };
  return validateSceneContext({...body,context_sha256:sha256Object(body)});
}

function loadSceneContext(worldPath,receiptPath,options={}){
  if(!worldPath||!receiptPath){
    throw new Error("spatialruntime_scene_world_and_receipt_required");
  }
  const world=JSON.parse(fs.readFileSync(worldPath,"utf8"));
  const receipt=JSON.parse(fs.readFileSync(receiptPath,"utf8"));
  if(options.handoffPath){
    const handoff=JSON.parse(fs.readFileSync(options.handoffPath,"utf8"));
    return validateSceneHandoff(world,receipt,handoff,options);
  }
  return validateSceneArtifacts(world,receipt,options);
}

function loadSceneContextFromHandoff(worldPath,receiptPath,handoffPath,options={}){
  if(!handoffPath)throw new Error("spatialruntime_scene_handoff_path_required");
  return loadSceneContext(worldPath,receiptPath,{...options,handoffPath});
}

function sceneWorldIdentity(context){
  const validated=validateSceneContext(context);
  if(
    !Number.isInteger(validated.world_snapshot_revision)||
    validated.world_snapshot_revision<0
  ){
    throw new Error("spatialruntime_scene_context_world_revision_required");
  }
  if(!isSha256(validated.world_snapshot_sha256)){
    throw new Error("spatialruntime_scene_context_world_sha256_required");
  }
  return {
    world_snapshot_revision:validated.world_snapshot_revision,
    world_snapshot_sha256:validated.world_snapshot_sha256
  };
}

module.exports={
  WORLD_SCHEMA,
  VALIDATION_SCHEMA,
  HANDOFF_SCHEMA,
  CONTEXT_SCHEMA,
  canonical,
  sha256Object,
  targetKey,
  validateSceneContext,
  loadPinnedSceneContext,
  validateSceneArtifacts,
  validateSceneHandoff,
  loadSceneContext,
  loadSceneContextFromHandoff,
  sceneWorldIdentity
};
