"use strict";

const {
  classifySimulationTrust
}=require("./airtrajectory_counterfactual_adapter.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function deviceKey(target){return [target.area,target.entity,target.instance||"default"].join("::")}
function simulatableOpeningPatch(p){
  return p&&p.op==="PATCH_SLOT"&&p.slot==="opening"&&p.target&&Number.isFinite(Number(p.value));
}

function buildStrategyRequest({
  label="shadow-strategy",
  patches=[],
  origin,
  opening_map={},
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
      if(!openingId)throw new Error("strategy_counterfactual_opening_mapping_missing:"+deviceKey(patch.target));
      actions.push({opening_id:openingId,target_pct:Number(patch.value)});
    }else{
      unsupported.push(clone(patch));
    }
  }
  if(!actions.length)throw new Error("strategy_counterfactual_requires_opening_action");
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

function selectStrategyBranch(response,label){
  const branch=(response&&response.branches||[]).find(x=>x.label===label);
  if(!branch)throw new Error("strategy_counterfactual_branch_missing:"+label);
  return branch;
}

function normalizeStrategyOutcome({response,branch,patches,unsupported_actions}={}){
  const trust=classifySimulationTrust(response,branch);
  const complete=(unsupported_actions||[]).length===0;
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
      complete_physics_coverage:complete
    },
    result:{
      end_co2_ppm:Number(branch.end_co2_ppm),
      end_co2_ppm_by_zone:clone(branch.end_co2_ppm_by_zone||{}),
      path_flow_kg_s:clone(branch.path_flow_kg_s||{}),
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
    profile_id
  }={}){
    if(!profile_id)throw new Error("strategy_counterfactual_profile_id_required");
    this.base_url=base_url.replace(/\/$/,"");
    this.endpoint=endpoint.startsWith("/")?endpoint:("/"+endpoint);
    this.transport=transport||this.defaultTransport.bind(this);
    this.opening_map={...opening_map};
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
      label,patches,origin,opening_map:this.opening_map,profile_id:this.profile_id,
      horizon_minutes,request_id
    });
    const response=await this.transport(built.request);
    const branch=selectStrategyBranch(response,label);
    return normalizeStrategyOutcome({
      response,branch,patches,unsupported_actions:built.unsupported_actions
    });
  }
}

module.exports={
  AirTrajectoryStrategyCounterfactualAdapter,
  buildStrategyRequest,
  selectStrategyBranch,
  normalizeStrategyOutcome,
  simulatableOpeningPatch
};
