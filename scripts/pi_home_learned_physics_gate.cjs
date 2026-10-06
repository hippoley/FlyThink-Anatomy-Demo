"use strict";

const {validateSemanticPhysicsAlignment}=require("./pi_home_generalization_counterfactual.cjs");
const {summarizePhysicalGeneralization}=require("./pi_home_generalization_claim.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function learnedRowToPrediction(row={}){
  return {
    candidate_ranking:(row.ranking||[]).map(x=>({
      target:clone(x.target),
      score:x.score
    })),
    patches:row.predicted?[{target:clone(row.predicted)}]:[],
    replay_conditioned:false,
    learned_checkpoint:true
  };
}

function buildLearnedPhysicsClaim({
  learned_eval,
  tournaments_by_case={},
  min_physical_coverage_ratio=.5,
  min_confirmation_rate=.8
}={}){
  if(!learned_eval||learned_eval.schema_version!=="pi-home-learned-checkpoint-shadow-eval-v1"){
    throw new Error("learned_checkpoint_eval_required");
  }
  const rows=learned_eval.rows||[];
  const alignments=rows.map(row=>{
    const tournament=tournaments_by_case[row.id];
    if(!tournament){
      return {
        id:row.id,
        decision:"BLOCKED",
        reason:"physical_evidence_missing",
        counterfactual_confirmed:false
      };
    }
    return {
      id:row.id,
      ...validateSemanticPhysicsAlignment({
        prediction:learnedRowToPrediction(row),
        tournament
      })
    };
  });

  const labelSupported=
    learned_eval.exact_replay_hits===0 &&
    learned_eval.exact===1 &&
    rows.length>0;

  const generalization_eval={
    schema_version:"pi-home-generalization-eval-v1",
    holdout:{cases:rows.length},
    claim:{generalization_reality_delta:labelSupported}
  };

  const claim=summarizePhysicalGeneralization({
    generalization_eval,
    alignments,
    min_physical_coverage_ratio,
    min_confirmation_rate
  });

  return {
    schema_version:"pi-home-learned-physics-claim-v1",
    shadow_only:true,
    learned_checkpoint_label_supported:labelSupported,
    alignments,
    claim,
    device_execution_authorized:false
  };
}

module.exports={buildLearnedPhysicsClaim,learnedRowToPrediction};
