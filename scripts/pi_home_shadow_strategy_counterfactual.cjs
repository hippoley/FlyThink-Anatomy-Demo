"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function strategyOutcomeToShadowMetrics(simulated={},goal={}){
  const end=Number(simulated&&simulated.result&&simulated.result.end_co2_ppm);
  const threshold=Number(goal&&goal.co2_below);
  const goalCompleted=Number.isFinite(end)&&Number.isFinite(threshold)?end<threshold:false;
  return {
    provenance:simulated.provenance,
    trusted_for_promotion:simulated.trusted_for_promotion===true,
    simulator:clone(simulated.simulator||null),
    strategy:clone(simulated.strategy||null),
    goal_completed:goalCompleted,
    wrong_target:0,
    correction_needed:0,
    extra_actions:0,
    end_co2_ppm:Number.isFinite(end)?end:null,
    end_co2_ppm_by_zone:clone(simulated&&simulated.result&&simulated.result.end_co2_ppm_by_zone||{}),
    path_flow_kg_s:clone(simulated&&simulated.result&&simulated.result.path_flow_kg_s||{}),
    return_value:simulated&&simulated.result&&simulated.result.return_value
  };
}

async function attachShadowStrategyCounterfactual({
  monitor,
  record_id,
  adapter,
  origin,
  goal,
  label="shadow-strategy",
  horizon_minutes=30
}={}){
  if(!monitor||typeof monitor.attachOutcome!=="function")throw new Error("shadow_monitor_required");
  if(!adapter||typeof adapter.simulate!=="function")throw new Error("strategy_counterfactual_adapter_required");
  const record=monitor.records.find(x=>x.id===record_id);
  if(!record)throw new Error("shadow_record_not_found:"+record_id);
  const patches=Array.isArray(record.shadow&&record.shadow.patches)?record.shadow.patches:[];
  if(!patches.length)throw new Error("shadow_strategy_patches_required");
  const simulated=await adapter.simulate({
    label,
    patches,
    origin,
    horizon_minutes,
    request_id:"shadow-strategy-cf:"+record_id
  });
  const shadowOutcome=strategyOutcomeToShadowMetrics(simulated,goal||{});
  const currentOutcome=record.actual_outcome&&record.actual_outcome.current
    ?record.actual_outcome.current
    :null;
  return monitor.attachOutcome(record_id,{
    current:clone(currentOutcome),
    shadow:shadowOutcome
  });
}

module.exports={attachShadowStrategyCounterfactual,strategyOutcomeToShadowMetrics};
