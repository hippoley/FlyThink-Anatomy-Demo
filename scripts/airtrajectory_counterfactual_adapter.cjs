"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function deviceKey(target){return [target.area,target.entity,target.instance||"default"].join("::")}

function openingPatch(patch){
  return patch&&patch.op==="PATCH_SLOT"&&patch.slot==="opening"&&patch.target&&Number.isFinite(Number(patch.value));
}

function buildForkRequest({patch,origin,opening_map={},topology_id="demo-3zone",horizon_minutes=30,request_id=""}={}){
  if(!openingPatch(patch))throw new Error("counterfactual_requires_absolute_opening_patch");
  const openingId=opening_map[deviceKey(patch.target)];
  if(!openingId)throw new Error("counterfactual_opening_mapping_missing:"+deviceKey(patch.target));
  if(!origin||typeof origin.co2_ppm!=="object"||typeof origin.opening_pct!=="object"){
    throw new Error("counterfactual_origin_incomplete");
  }
  return {
    request_id,
    topology_id,
    opening_id:openingId,
    origin:clone(origin),
    horizon_minutes:Number(horizon_minutes)
  };
}

function selectExactBranch(response,targetPct){
  const branch=(response&&response.branches||[]).find(x=>Number(x.target_pct)===Number(targetPct));
  if(!branch)throw new Error("counterfactual_exact_branch_missing:"+String(targetPct));
  return branch;
}

function classifySimulationTrust(response,branch){
  const backend=String(response&&response.backend||"");
  const fidelity=String(response&&response.physics_fidelity||"");
  const provenance=String(branch&&branch.provenance||"");
  const explicit=(branch&&typeof branch.trusted_for_promotion==="boolean")
    ?branch.trusted_for_promotion
    :(response&&typeof response.trusted_for_promotion==="boolean"?response.trusted_for_promotion:null);
  const toy=backend.includes("toy")||fidelity.toLowerCase().includes("toy")||provenance.includes("not engineering truth");
  const contam=backend.toLowerCase().includes("contam")||fidelity.toUpperCase()==="CONTAM";
  const trusted=explicit===false?false:!!(contam&&!toy&&explicit!==false);
  return {
    backend,
    physics_fidelity:fidelity||null,
    trusted_for_promotion:trusted,
    trust_reason:explicit===false?"simulator_declared_untrusted":(toy?"toy_backend_not_engineering_truth":(contam?"contam_simulation":"unrecognized_simulator"))
  };
}

function normalizeForkOutcome({response,patch,branch}={}){
  const trust=classifySimulationTrust(response,branch);
  return {
    provenance:"counterfactual_simulation",
    trusted_for_promotion:trust.trusted_for_promotion,
    simulator:{
      service:"AirTrajectory",
      backend:trust.backend,
      physics_fidelity:trust.physics_fidelity,
      trust_reason:trust.trust_reason,
      trace_id:response&&response.trace_id||null,
      topology_id:response&&response.topology_id||null,
      horizon_minutes:response&&response.horizon_minutes||null
    },
    action:clone(patch),
    result:{
      target_pct:Number(branch.target_pct),
      end_co2_ppm:Number(branch.end_co2_ppm),
      series:clone(branch.series||[]),
      return_value:Number(branch.return)
    }
  };
}

class AirTrajectoryCounterfactualAdapter{
  constructor({base_url="http://127.0.0.1:8765",transport=null,opening_map={},topology_id="demo-3zone"}={}){
    this.base_url=base_url.replace(/\/$/,"");
    this.transport=transport||this.defaultTransport.bind(this);
    this.opening_map={...opening_map};
    this.topology_id=topology_id;
  }

  async defaultTransport(payload){
    const response=await fetch(this.base_url+"/fork",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    if(!response.ok)throw new Error("airtrajectory_http_"+response.status);
    return await response.json();
  }

  async simulate({patch,origin,horizon_minutes=30,request_id=""}={}){
    const request=buildForkRequest({
      patch,origin,opening_map:this.opening_map,topology_id:this.topology_id,horizon_minutes,request_id
    });
    const response=await this.transport(request);
    const branch=selectExactBranch(response,patch.value);
    return normalizeForkOutcome({response,patch,branch});
  }
}

module.exports={
  AirTrajectoryCounterfactualAdapter,
  buildForkRequest,
  selectExactBranch,
  normalizeForkOutcome,
  classifySimulationTrust,
  openingPatch
};
