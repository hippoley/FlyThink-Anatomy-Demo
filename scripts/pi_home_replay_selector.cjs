"use strict";

const {scoreTrajectory}=require("./pi_home_trajectory_scorer.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function classifyBucket(trajectory,score){
  const interventions=trajectory.interventions||[];
  const recovered=score.outcome_label==="SUCCESS"&&interventions.some(x=>
    x&&["CORRECTION","PREFERENCE_FEEDBACK"].includes(x.kind)
  );
  if(score.positive_example&&!recovered)return "positive";
  if(recovered||score.quality==="MEDIUM")return "hard";
  return "negative";
}

function selectReplaySamples(trajectories=[],options={}){
  const maxPerBucket=Number(options.max_per_bucket||32);
  if(maxPerBucket<1)throw new Error("replay_max_per_bucket_invalid");

  const rows=(trajectories||[]).map(t=>{
    const score=scoreTrajectory(t,options.weights||{});
    return {
      episode_id:t.episode_id,
      bucket:classifyBucket(t,score),
      score,
      trajectory:clone(t)
    };
  });

  const positive=rows.filter(x=>x.bucket==="positive")
    .sort((a,b)=>b.score.score-a.score.score)
    .slice(0,maxPerBucket);
  const hard=rows.filter(x=>x.bucket==="hard")
    .sort((a,b)=>b.score.score-a.score.score)
    .slice(0,maxPerBucket);
  const negative=rows.filter(x=>x.bucket==="negative")
    .sort((a,b)=>a.score.score-b.score.score)
    .slice(0,maxPerBucket);

  return {
    schema_version:"pi-home-replay-manifest-v1",
    counts:{positive:positive.length,hard:hard.length,negative:negative.length},
    positive,
    hard,
    negative
  };
}

module.exports={selectReplaySamples,classifyBucket};
