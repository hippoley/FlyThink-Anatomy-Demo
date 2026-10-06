"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function stable(v){return JSON.stringify(v)}

function hasOutcomeEvidence(caseRow){
  const b=caseRow&&caseRow.baseline;
  const r=caseRow&&caseRow.replay;
  return !!(
    b&&r&&
    typeof b.goal_completed==="boolean"&&
    typeof r.goal_completed==="boolean"
  );
}

function buildPreferencePairs(cases=[]){
  const pairs=[];
  const skipped=[];
  for(const c of cases||[]){
    if(!hasOutcomeEvidence(c)){
      skipped.push({id:c&&c.id||null,reason:"missing_measured_outcome"});
      continue;
    }
    const baseline=clone(c.baseline||{});
    const replay=clone(c.replay||{});
    const baselineSucceeded=baseline.goal_completed===true;
    const replaySucceeded=replay.goal_completed===true;
    const same=stable(baseline.patches||[])===stable(replay.patches||[]);

    if(same){
      skipped.push({id:c.id,reason:"no_behavioral_difference"});
      continue;
    }
    if(replaySucceeded&&!baselineSucceeded){
      pairs.push({
        schema_version:"pi-home-preference-pair-v1",
        id:c.id,
        evidence:clone(c.evidence||null),
        context:clone(c.context||null),
        gold:clone(c.gold||null),
        chosen:replay,
        rejected:baseline,
        rationale:"measured_replay_recovered_goal"
      });
      continue;
    }
    skipped.push({id:c.id,reason:"no_measured_preference"});
  }
  return {
    schema_version:"pi-home-preference-dataset-v1",
    pairs,
    skipped
  };
}

module.exports={buildPreferencePairs,hasOutcomeEvidence};
