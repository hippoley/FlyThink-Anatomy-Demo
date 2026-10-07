"use strict";

const fs=require("fs");
const {
  evaluateProviderCalibration,
  verifyCalibrationReport,
  buildTrustRegistryEntryFromCalibration,
  buildTrustAttestationFromCalibration
}=require("./pi_home_provider_calibration.cjs");

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}
function flag(name){return process.argv.includes(name)}
function num(name,fallback){
  const value=arg(name);
  if(value==null)return fallback;
  const n=Number(value);
  if(!Number.isFinite(n))throw new Error("invalid_numeric_arg:"+name);
  return n;
}

function main(){
  const datasetPath=arg("--dataset");
  const outPath=arg("--out");
  if(!datasetPath)throw new Error("--dataset is required");
  if(!outPath)throw new Error("--out is required");

  const dataset=JSON.parse(fs.readFileSync(datasetPath,"utf8"));
  const report=evaluateProviderCalibration(dataset,{
    min_cases:num("--min-cases",10),
    min_pairwise_comparisons:num("--min-pairwise-comparisons",20),
    min_pairwise_accuracy:num("--min-pairwise-accuracy",.9),
    min_top1_accuracy:num("--min-top1-accuracy",.9)
  });
  verifyCalibrationReport(report);
  fs.writeFileSync(outPath,JSON.stringify(report,null,2)+"\n","utf8");

  const calibrationRef=arg("--calibration-ref");
  const approvedBy=arg("--approved-by");
  const trustOut=arg("--trust-entry-out");
  let trust_entry=null;
  let trust_attestation=null;

  if(calibrationRef||approvedBy||trustOut){
    if(!calibrationRef||!approvedBy||!trustOut){
      throw new Error("trust entry output requires --calibration-ref --approved-by --trust-entry-out");
    }
    trust_entry=buildTrustRegistryEntryFromCalibration(report,{
      calibration_ref:calibrationRef,
      approved_by:approvedBy
    });
    trust_attestation=buildTrustAttestationFromCalibration(report,{
      calibration_ref:calibrationRef
    });
    fs.writeFileSync(trustOut,JSON.stringify({
      schema_version:"pi-home-provider-trust-candidate-v1",
      registry_entry:trust_entry,
      trust_attestation
    },null,2)+"\n","utf8");
  }

  const summary={
    schema_version:"pi-home-provider-calibration-cli-v1",
    provider_id:report.provider_id,
    dimension:report.dimension,
    source_kind:report.source_kind,
    eligible_for_registry:report.eligible_for_registry,
    failures:report.failures,
    metrics:report.metrics,
    report_digest:report.report_digest,
    trust_entry_emitted:trust_entry!==null
  };
  console.log(JSON.stringify(summary));
  if(flag("--require-eligible")&&report.eligible_for_registry!==true){
    process.exitCode=2;
  }
}

if(require.main===module)main();

module.exports={main};
