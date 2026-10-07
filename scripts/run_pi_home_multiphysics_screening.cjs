"use strict";

const fs=require("fs");
const {
  fuseCandidateEvidence,
  rainIngressScreeningProvider,
  acousticScreeningProvider,
  contamProviderFromP47Evidence
}=require("./pi_home_multiphysics_evidence.cjs");

function read(path){return JSON.parse(fs.readFileSync(path,"utf8"))}
function targetKey(t){return [t.area,t.entity,t.instance||"default"].join("::")}

function learnedLabel(caseDef,learnedRow){
  const candidates=caseDef.context&&caseDef.context.candidates||[];
  const predicted=learnedRow&&learnedRow.predicted;
  const index=candidates.findIndex(x=>targetKey(x.target)===targetKey(predicted));
  if(index<0)throw new Error("learned_target_not_in_candidate_set:"+caseDef.id);
  return "candidate-"+String(index+1);
}

function screeningProviderFor(caseDef){
  const required=new Set(caseDef.physics&&caseDef.physics.required_dimensions||[]);
  const providers=[];
  if(required.has("rain_ingress"))providers.push(rainIngressScreeningProvider(caseDef));
  if(required.has("noise"))providers.push(acousticScreeningProvider(caseDef));
  return providers;
}

function evaluateCase(caseDef,learnedRow,realRow){
  const providers=[];
  if(realRow&&realRow.status==="REAL_CONTAM_EXECUTED"){
    providers.push(contamProviderFromP47Evidence(realRow));
  }
  providers.push(...screeningProviderFor(caseDef));
  const required=caseDef.physics&&caseDef.physics.required_dimensions||[];
  const weights=caseDef.physics&&caseDef.physics.dimension_weights||{};
  return {
    case_id:caseDef.id,
    learned_candidate_label:learnedLabel(caseDef,learnedRow),
    providers,
    fusion:fuseCandidateEvidence({
      required_dimensions:required,
      provider_results:providers,
      dimension_weights:weights,
      learned_candidate_label:learnedLabel(caseDef,learnedRow)
    })
  };
}

function main(){
  const args=process.argv.slice(2);
  const get=name=>{
    const i=args.indexOf(name);
    if(i<0||!args[i+1])throw new Error("missing_arg:"+name);
    return args[i+1];
  };
  const benchmark=read(get("--benchmark"));
  const learned=read(get("--learned-eval"));
  const real=read(get("--real-contam"));
  const rows=[];
  for(const caseDef of benchmark.cases||[]){
    const learnedRow=(learned.rows||[]).find(x=>x.id===caseDef.id);
    const realRow=(real.results||[]).find(x=>x.case_id===caseDef.id);
    if(!learnedRow)throw new Error("learned_row_missing:"+caseDef.id);
    rows.push(evaluateCase(caseDef,learnedRow,realRow));
  }
  const trusted=rows.filter(x=>x.fusion.trusted_for_generalization_claim===true);
  const payload={
    schema_version:"pi-home-multiphysics-screening-run-v1",
    cases:rows.length,
    trusted_generalization_cases:trusted.length,
    device_execution_authorized:false,
    rows
  };
  const outPath=args.includes("--out")?get("--out"):null;
  if(outPath)fs.writeFileSync(outPath,JSON.stringify(payload,null,2)+"\n","utf8");
  console.log(JSON.stringify(payload,null,2));
  if(trusted.length!==0){
    throw new Error("screening providers must not produce trusted promotion claims");
  }
}

if(require.main===module)main();

module.exports={screeningProviderFor,evaluateCase,learnedLabel};
