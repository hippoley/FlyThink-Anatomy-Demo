"use strict";

const INTERVENTION_KINDS=Object.freeze([
  "CORRECTION",
  "PREFERENCE_FEEDBACK",
  "CANCEL",
  "TAKEOVER"
]);

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function normalizeHumanIntervention(input={}){
  const kind=String(input.kind||"").toUpperCase();
  if(!INTERVENTION_KINDS.includes(kind))throw new Error("unsupported_intervention_kind:"+kind);
  if(typeof input.text!=="string"||!input.text.trim())throw new Error("intervention_text_required");
  return {
    kind,
    text:input.text.trim(),
    dimension:input.dimension||null,
    sentiment:input.sentiment||null,
    correction:clone(input.correction||null),
    target:clone(input.target||null),
    metadata:clone(input.metadata||null)
  };
}

function buildTrajectoryRecord({episode,runtime,executionLedger=[]}={}){
  if(!episode||!episode.id)throw new Error("trajectory_episode_required");
  const trace=Array.isArray(episode.autonomy_trace)?episode.autonomy_trace:[];
  const interventions=Array.isArray(episode.interventions)?episode.interventions:[];
  const goalPrefix="auto:"+episode.id+":";
  const physical=(executionLedger||[])
    .filter(x=>x&&typeof x.turn_id==="string"&&x.turn_id.startsWith(goalPrefix))
    .map(x=>clone(x));
  return {
    schema_version:"pi-home-trajectory-v1",
    episode_id:episode.id,
    goal:clone(episode.goal),
    desired_state:clone(episode.desired_state),
    constraints:clone(episode.constraints),
    initial_strategy:clone(episode.initial_strategy),
    final_strategy:clone(episode.strategy),
    initial_device_state:clone(episode.initial_device_state||null),
    final_device_state:clone(runtime&&runtime.devices||null),
    status:episode.status||null,
    stop_reason:episode.autonomy_stop_reason||null,
    outcome:clone(episode.autonomy_outcome||null),
    interventions:clone(interventions),
    strategy_history:clone(episode.strategy_history||[]),
    steps:clone(trace),
    physical_executions:physical,
    summary:{
      steps:trace.length,
      physical_actions:physical.length,
      interventions:interventions.length,
      corrected:interventions.some(x=>x.kind==="CORRECTION"),
      cancelled:interventions.some(x=>x.kind==="CANCEL"),
      human_takeover:interventions.some(x=>x.kind==="TAKEOVER")
    }
  };
}

module.exports={INTERVENTION_KINDS,normalizeHumanIntervention,buildTrajectoryRecord};
