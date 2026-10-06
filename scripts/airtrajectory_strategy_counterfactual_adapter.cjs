"use strict";

const {
  classifySimulationTrust
}=require("./airtrajectory_counterfactual_adapter.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function deviceKey(target){return [target.area,target.entity,target.instance||"default"].join("::")}
function simulatableOpeningPatch(p){
  return p&&p.op==="PATCH_SLOT"&&p.slot==="opening"&&p.target&&Number.isFinite(Number(p.value));
}
function simulatableScalarPatch(p,actuator_map={}){
  return p&&p.op==="PATCH_SLOT"&&p.target&&Number.isFinite(Number(p.value))&&
    Object.prototype.hasOwnProperty.call(actuator_map,deviceKey(p.target));
}
function simulatablePhysicalPatch(p,{opening_map={},actuator_map={}}={}){
  if(simulatableOpeningPatch(p)){
    return Object.prototype.hasOwnProperty.call(opening_map,deviceKey(p.target));
  }
  return simulatableScalarPatch(p,actuator_map);
}

function buildStrategyRequest({
  label="shadow-strategy",
  patches=[],
  origin,
  opening_map={},
  actuator_map={},
  profile_id,
  horizon_minutes=30,
  request_id=""
}={}){
  if(!profile_id)throw new Error("strategy_counterfactual_profile_id_required");
  if(!origin||typeof origin.co2_ppm!=="object"||typeof origin.opening_pct!=="object"){
    throw new Error("strategy_counterfactual_origin_incomplete");
  }
  const actions=[];
  const unsupported=[];
  for(const patch of patches||[]){
    if(simulatableOpeningPatch(patch)){
      const openingId=opening_map[deviceKey(patch.target)];
      if(!openingId){
        unsupported.push({...clone(patch),unsupported_reason:"opening_mapping_missing"});
        continue;
      }
      actions.push({opening_id:openingId,target_pct:Number(patch.value)});
      continue;
    }
    if(simulatableScalarPatch(patch,actuator_map)){
      actions.push({
        actuator_id:actuator_map[deviceKey(patch.target)],
        target_value:Number(patch.value)
      });
      continue;
    }
    unsupported.push({...clone(patch),unsupported_reason:"scalar_mapping_missing_or_patch_unsupported"});
  }
  if(!actions.length)throw new Error("strategy_counterfactual_requires_supported_action");
  return {
    request:{
      request_id,
      profile_id,
      origin:clone(origin),
      horizon_minutes:Number(horizon_minutes),
      candidates:[{label,actions}]
    },
    unsupported_actions:unsupported
  };
}

function buildBatchStrategyRequest({
  candidates=[],
  origin,
  opening_map={},
  actuator_map={},
  profile_id,
  horizon_minutes=30,
  request_id=""
}={}){
  if(!Array.isArray(candidates)||!candidates.length)throw new Error("strategy_counterfactual_candidates_required");
  if(!profile_id)throw new Error("strategy_counterfactual_profile_id_required");
  if(!origin||typeof origin.co2_ppm!=="object"||typeof origin.opening_pct!=="object"){
    throw new Error("strategy_counterfactual_origin_incomplete");
  }
  const seen=new Set();
  const requestCandidates=[];
  const metadata={};
  for(const candidate of candidates){
    const label=String(candidate&&candidate.label||"");
    if(!label)throw new Error("strategy_counterfactual_candidate_label_required");
    if(seen.has(label))throw new Error("strategy_counterfactual_duplicate_label:"+label);
    seen.add(label);
    const built=buildStrategyRequest({
      label,
      patches:candidate.patches||[],
      origin,
      opening_map,
      actuator_map,
      profile_id,
      horizon_minutes,
      request_id
    });
    requestCandidates.push(built.request.candidates[0]);
    metadata[label]={
      patches:clone(candidate.patches||[]),
      unsupported_actions:clone(built.unsupported_actions||[])
    };
  }
  return {
    request:{
      request_id,
      profile_id,
      origin:clone(origin),
      horizon_minutes:Number(horizon_minutes),
      candidates:requestCandidates
    },
    metadata
  };
}

function schemaNumber(value){
  const n=Number.parseFloat(String(value||""));
  return Number.isFinite(n)?n:null;
}

function assertStrategyResponseContract(response,{profile_id}={}){
  if(!response||typeof response!=="object")throw new Error("airtrajectory_strategy_response_required");
  const version=schemaNumber(response.schema_version);
  if(version===null||version<0.4)throw new Error("airtrajectory_strategy_schema_too_old");
  if(response.backend!=="contamxpy")throw new Error("airtrajectory_strategy_backend_not_contam");
  if(String(response.physics_fidelity||"").toUpperCase()!=="CONTAM"){
    throw new Error("airtrajectory_strategy_fidelity_not_contam");
  }
  if(profile_id&&String(response.profile_id||"")!==String(profile_id)){
    throw new Error("airtrajectory_strategy_profile_mismatch");
  }
  if(!Array.isArray(response.branches))throw new Error("airtrajectory_strategy_branches_required");
  return true;
}

function selectStrategyBranch(response,label){
  const branch=(response&&response.branches||[]).find(x=>x.label===label);
  if(!branch)throw new Error("strategy_counterfactual_branch_missing:"+label);
  return branch;
}

function normalizeStrategyOutcome({response,branch,patches,unsupported_actions}={}){
  const trust=classifySimulationTrust(response,branch);
  const simulatedCount=(branch&&branch.actions||[]).length;
  const unsupportedCount=(unsupported_actions||[]).length;
  const totalCount=simulatedCount+unsupportedCount;
  const coverageRatio=totalCount?simulatedCount/totalCount:0;
  const complete=unsupportedCount===0&&simulatedCount>0;
  return {
    provenance:"counterfactual_simulation",
    trusted_for_promotion:trust.trusted_for_promotion&&complete,
    simulator:{
      service:"AirTrajectory",
      backend:trust.backend,
      physics_fidelity:trust.physics_fidelity,
      trust_reason:!complete?"strategy_partially_simulated":trust.trust_reason,
      profile_id:response&&response.profile_id||null,
      topology_id:response&&response.topology_id||null,
      horizon_minutes:response&&response.horizon_minutes||null
    },
    strategy:{
      patches:clone(patches||[]),
      simulated_actions:clone(branch&&branch.actions||[]),
      unsupported_actions:clone(unsupported_actions||[]),
      simulated_action_count:simulatedCount,
      unsupported_action_count:unsupportedCount,
      physics_coverage_ratio:Number(coverageRatio.toFixed(4)),
      complete_physics_coverage:complete
    },
    result:{
      end_co2_ppm:Number(branch.end_co2_ppm),
      end_co2_ppm_by_zone:clone(branch.end_co2_ppm_by_zone||{}),
      path_flow_kg_s:clone(branch.path_flow_kg_s||{}),
      end_scalar_values:clone(branch.end_scalar_values||{}),
      series:clone(branch.series||[]),
      return_value:Number(branch.return)
    }
  };
}

class AirTrajectoryStrategyCounterfactualAdapter{
  constructor({
    base_url="http://127.0.0.1:8765",
    endpoint="/fork/contam-strategy",
    transport=null,
    opening_map={},
    actuator_map={},
    profile_id
  }={}){
    if(!profile_id)throw new Error("strategy_counterfactual_profile_id_required");
    this.base_url=base_url.replace(/\/$/,"");
    this.endpoint=endpoint.startsWith("/")?endpoint:("/"+endpoint);
    this.transport=transport||this.defaultTransport.bind(this);
    this.opening_map={...opening_map};
    this.actuator_map={...actuator_map};
    this.profile_id=profile_id;
  }

  async defaultTransport(payload){
    const response=await fetch(this.base_url+this.endpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    if(!response.ok)throw new Error("airtrajectory_http_"+response.status);
    return await response.json();
  }

  async simulate({label="shadow-strategy",patches,origin,horizon_minutes=30,request_id=""}={}){
    const built=buildStrategyRequest({
      label,patches,origin,opening_map:this.opening_map,actuator_map:this.actuator_map,profile_id:this.profile_id,
      horizon_minutes,request_id
    });
    const response=await this.transport(built.request);
    assertStrategyResponseContract(response,{profile_id:this.profile_id});
    const branch=selectStrategyBranch(response,label);
    return normalizeStrategyOutcome({
      response,branch,patches,unsupported_actions:built.unsupported_actions
    });
  }

  async simulateMany({candidates,origin,horizon_minutes=30,request_id=""}={}){
    const built=buildBatchStrategyRequest({
      candidates,
      origin,
      opening_map:this.opening_map,
      actuator_map:this.actuator_map,
      profile_id:this.profile_id,
      horizon_minutes,
      request_id
    });
    const response=await this.transport(built.request);
    assertStrategyResponseContract(response,{profile_id:this.profile_id});
    return (candidates||[]).map(candidate=>{
      const label=String(candidate.label);
      const branch=selectStrategyBranch(response,label);
      const meta=built.metadata[label];
      return {
        label,
        outcome:normalizeStrategyOutcome({
          response,
          branch,
          patches:meta.patches,
          unsupported_actions:meta.unsupported_actions
        })
      };
    });
  }
}

module.exports={
  AirTrajectoryStrategyCounterfactualAdapter,
  buildStrategyRequest,
  buildBatchStrategyRequest,
  schemaNumber,
  assertStrategyResponseContract,
  selectStrategyBranch,
  normalizeStrategyOutcome,
  simulatableOpeningPatch,
  simulatableScalarPatch,
  simulatablePhysicalPatch
};
