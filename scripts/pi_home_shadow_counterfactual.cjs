"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function chooseSingleOpeningPatch(prediction={}){
  const patches=(prediction.patches||[]).filter(p=>
    p&&p.op==="PATCH_SLOT"&&p.slot==="opening"&&p.target&&Number.isFinite(Number(p.value))
  );
  if(patches.length!==1)throw new Error("shadow_counterfactual_requires_single_opening_patch");
  return patches[0];
}

function simulatorOutcomeToShadowMetrics(simulated={},goal={}){
  const end=Number(simulated&&simulated.result&&simulated.result.end_co2_ppm);
  const threshold=Number(goal&&goal.co2_below);
  const goalCompleted=Number.isFinite(end)&&Number.isFinite(threshold)?end<threshold:false;
  return {
    provenance:simulated.provenance,
    trusted_for_promotion:simulated.trusted_for_promotion===true,
    simulator:clone(simulated.simulator||null),
    goal_completed:goalCompleted,
    wrong_target:0,
    correction_needed:0,
    extra_actions:0,
    end_co2_ppm:Number.isFinite(end)?end:null,
    return_value:simulated&&simulated.result&&simulated.result.return_value
  };
}

async function attachShadowCounterfactual({
  monitor,
  record_id,
  adapter,
  origin,
  goal,
  horizon_minutes=30
}={}){
  if(!monitor||typeof monitor.attachOutcome!=="function")throw new Error("shadow_monitor_required");
  if(!adapter||typeof adapter.simulate!=="function")throw new Error("counterfactual_adapter_required");
  const record=monitor.records.find(x=>x.id===record_id);
  if(!record)throw new Error("shadow_record_not_found:"+record_id);
  const patch=chooseSingleOpeningPatch(record.shadow||{});
  const simulated=await adapter.simulate({
    patch,
    origin,
    horizon_minutes,
    request_id:"shadow-cf:"+record_id
  });
  const shadowOutcome=simulatorOutcomeToShadowMetrics(simulated,goal||{});
  const currentOutcome=record.actual_outcome&&record.actual_outcome.current
    ?record.actual_outcome.current
    :null;
  return monitor.attachOutcome(record_id,{
    current:clone(currentOutcome),
    shadow:shadowOutcome
  });
}

module.exports={attachShadowCounterfactual,chooseSingleOpeningPatch,simulatorOutcomeToShadowMetrics};
