"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function validateEvidence(records=[]){
  for(const x of records||[]){
    if(!x||x.schema_version!=="pi-home-strategy-promotion-evidence-v1"){
      throw new Error("unsupported_strategy_promotion_evidence");
    }
  }
}

function summarizeEvidence(records=[]){
  validateEvidence(records);
  const candidates=records.filter(x=>x.decision==="SHADOW_PROMOTION_CANDIDATE");
  const blocked=records.filter(x=>x.decision==="BLOCKED");
  const keep=records.filter(x=>x.decision==="KEEP_CURRENT");
  const comparable=records.filter(x=>Number.isFinite(Number(x.estimated_advantage)));
  const meanAdv=comparable.length
    ?comparable.reduce((a,x)=>a+Number(x.estimated_advantage),0)/comparable.length
    :0;
  return {
    total:records.length,
    candidates:candidates.length,
    blocked:blocked.length,
    keep_current:keep.length,
    comparable:comparable.length,
    mean_advantage:Number(meanAdv.toFixed(4)),
    blocked_fraction:records.length?Number((blocked.length/records.length).toFixed(4)):0
  };
}

function evaluatePromotionGate(records=[],{
  min_cases=3,
  min_mean_advantage=0.2,
  max_blocked_fraction=0,
  approval=null,
  candidate_policy_id=null
}={}){
  const summary=summarizeEvidence(records);
  const evidenceReady=
    summary.total>=Number(min_cases) &&
    summary.comparable>=Number(min_cases) &&
    summary.mean_advantage>Number(min_mean_advantage) &&
    summary.blocked_fraction<=Number(max_blocked_fraction) &&
    summary.candidates>=Number(min_cases);

  const base={
    schema_version:"pi-home-promotion-gate-v1",
    candidate_policy_id:candidate_policy_id||null,
    thresholds:{
      min_cases:Number(min_cases),
      min_mean_advantage:Number(min_mean_advantage),
      max_blocked_fraction:Number(max_blocked_fraction)
    },
    evidence_summary:summary,
    evidence_ready:evidenceReady,
    device_execution_authorized:false
  };

  if(!evidenceReady){
    return {
      ...base,
      decision:"HOLD_SHADOW",
      reason:"promotion_evidence_below_gate",
      policy_switch_authorized:false
    };
  }

  if(!approval||approval.approved!==true){
    return {
      ...base,
      decision:"AWAIT_HUMAN_APPROVAL",
      reason:"evidence_ready_human_approval_required",
      policy_switch_authorized:false,
      approval:clone(approval||null)
    };
  }

  if(typeof approval.actor!=="string"||!approval.actor.trim()){
    return {
      ...base,
      decision:"AWAIT_HUMAN_APPROVAL",
      reason:"approval_actor_required",
      policy_switch_authorized:false,
      approval:clone(approval)
    };
  }

  return {
    ...base,
    decision:"POLICY_PROMOTION_AUTHORIZED",
    reason:"evidence_gate_and_human_approval_passed",
    policy_switch_authorized:true,
    approval:{
      approved:true,
      actor:approval.actor.trim(),
      scope:approval.scope||candidate_policy_id||null,
      note:approval.note||null
    }
  };
}

module.exports={evaluatePromotionGate,summarizeEvidence,validateEvidence};
