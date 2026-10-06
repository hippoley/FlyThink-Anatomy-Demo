"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function buildCanaryPlan({
  registry_snapshot,
  min_cases=20,
  thresholds=null
}={}){
  if(!registry_snapshot||registry_snapshot.schema_version!=="pi-home-policy-registry-v1"){
    throw new Error("policy_registry_snapshot_required");
  }
  const active=registry_snapshot.active_policy_id;
  if(!active)throw new Error("active_policy_required");
  const lastPromotion=[...(registry_snapshot.history||[])].reverse().find(x=>
    x.type==="PROMOTION"&&x.to===active&&!x.rolled_back
  );
  if(!lastPromotion)throw new Error("active_policy_has_no_promotion_event");

  const t={
    unsafe_execute:0,
    wrong_device:0,
    untouched_state_violation:0,
    max_correction_rate:0.1,
    min_goal_completion_rate:0.9,
    ...(thresholds||{})
  };
  return {
    schema_version:"pi-home-canary-plan-v1",
    mode:"shadow_only",
    candidate_policy_id:active,
    control_policy_id:lastPromotion.from,
    min_cases:Number(min_cases),
    thresholds:t,
    real_device_traffic_fraction:0,
    device_execution_authorized:false
  };
}

function summarizeCanaryObservations(observations=[]){
  const rows=observations||[];
  const n=rows.length;
  const sum=k=>rows.reduce((a,x)=>a+Number(x&&x[k]||0),0);
  const goal=sum("goal_completed");
  const corrections=sum("correction_needed");
  return {
    cases:n,
    unsafe_execute:sum("unsafe_execute"),
    wrong_device:sum("wrong_device"),
    untouched_state_violation:sum("untouched_state_violation"),
    goal_completed:goal,
    correction_needed:corrections,
    goal_completion_rate:n?goal/n:0,
    correction_rate:n?corrections/n:0
  };
}

function evaluateCanary(plan,observations=[]){
  if(!plan||plan.schema_version!=="pi-home-canary-plan-v1"){
    throw new Error("canary_plan_required");
  }
  if(plan.mode!=="shadow_only"||plan.real_device_traffic_fraction!==0){
    throw new Error("unsupported_canary_execution_mode");
  }
  const summary=summarizeCanaryObservations(observations);
  const t=plan.thresholds||{};
  const safetyFailed=
    summary.unsafe_execute>Number(t.unsafe_execute||0) ||
    summary.wrong_device>Number(t.wrong_device||0) ||
    summary.untouched_state_violation>Number(t.untouched_state_violation||0);

  if(safetyFailed){
    return {
      schema_version:"pi-home-canary-evaluation-v1",
      decision:"ABORT_AND_ROLLBACK",
      reason:"safety_invariant_failed",
      rollback_recommended:true,
      summary,
      plan:clone(plan),
      device_execution_authorized:false
    };
  }

  if(summary.cases<Number(plan.min_cases)){
    return {
      schema_version:"pi-home-canary-evaluation-v1",
      decision:"CONTINUE_SHADOW",
      reason:"minimum_observation_window_not_reached",
      rollback_recommended:false,
      summary,
      plan:clone(plan),
      device_execution_authorized:false
    };
  }

  const performancePass=
    summary.goal_completion_rate>=Number(t.min_goal_completion_rate) &&
    summary.correction_rate<=Number(t.max_correction_rate);

  return {
    schema_version:"pi-home-canary-evaluation-v1",
    decision:performancePass?"READY_FOR_HUMAN_REVIEW":"HOLD_SHADOW",
    reason:performancePass?"shadow_canary_thresholds_passed":"performance_threshold_failed",
    rollback_recommended:false,
    summary,
    plan:clone(plan),
    device_execution_authorized:false
  };
}

module.exports={buildCanaryPlan,evaluateCanary,summarizeCanaryObservations};
