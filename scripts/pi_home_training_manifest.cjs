"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function defaultWeight(bucket,row){
  if(bucket==="positive")return 1.0;
  if(bucket==="hard")return 1.35;
  if(bucket==="negative")return 0.45;
  return 0;
}

function supervisionMode(bucket,row){
  if(bucket==="positive")return "IMITATE";
  if(bucket==="hard")return "RECOVER";
  if(bucket==="negative")return "AVOID";
  return "IGNORE";
}

function flattenReplayManifest(replay,options={}){
  if(!replay||replay.schema_version!=="pi-home-replay-manifest-v1"){
    throw new Error("unsupported_replay_manifest");
  }
  const overrides=options.bucket_weights||{};
  const rows=[];
  for(const bucket of ["positive","hard","negative"]){
    for(const row of replay[bucket]||[]){
      const trajectory=row.trajectory||{};
      const base=overrides[bucket]!==undefined?Number(overrides[bucket]):defaultWeight(bucket,row);
      const quality=Number(row.score&&row.score.score||0);
      const weight=Math.max(0,base*(0.5+quality*0.5));
      rows.push({
        episode_id:row.episode_id,
        bucket,
        mode:supervisionMode(bucket,row),
        weight:Number(weight.toFixed(4)),
        quality_score:quality,
        outcome_label:row.score&&row.score.outcome_label||null,
        goal:clone(trajectory.goal||null),
        desired_state:clone(trajectory.desired_state||null),
        steps:clone(trajectory.steps||[]),
        interventions:clone(trajectory.interventions||[])
      });
    }
  }
  return rows;
}

function buildTrainingManifest(replay,options={}){
  const samples=flattenReplayManifest(replay,options);
  const byMode={IMITATE:0,RECOVER:0,AVOID:0,IGNORE:0};
  let totalWeight=0;
  for(const s of samples){
    byMode[s.mode]=(byMode[s.mode]||0)+1;
    totalWeight+=s.weight;
  }
  return {
    schema_version:"pi-home-training-manifest-v1",
    samples,
    counts:{
      total:samples.length,
      imitate:byMode.IMITATE||0,
      recover:byMode.RECOVER||0,
      avoid:byMode.AVOID||0
    },
    total_weight:Number(totalWeight.toFixed(4)),
    policy:{
      positive:"imitate clean high-quality success",
      hard:"learn recovery after correction/preference feedback",
      negative:"avoid failed/oscillating/stalled action patterns"
    }
  };
}

module.exports={buildTrainingManifest,flattenReplayManifest,defaultWeight,supervisionMode};
