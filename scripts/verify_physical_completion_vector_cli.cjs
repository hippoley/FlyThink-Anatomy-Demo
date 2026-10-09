"use strict";

const fs=require("fs");
const path=require("path");
const {
  digestObject,
  physicalEvidenceRow
}=require("./execution_receipt.cjs");

const SCHEMA="flythink.physical-completion-vector.v0.1";

function codeSet(row,authorizationBinding){
  const checks=row.checks||{};
  const codes=[];
  if(checks.target_match!==true)codes.push("target-binding-not-verified");
  if(checks.ack_verified!==true)codes.push("ack-not-verified");
  if(checks.fresh_readback_verified!==true)codes.push("fresh-readback-not-verified");
  if(checks.hardware_identity_stable!==true)codes.push("hardware-identity-not-stable");
  if(checks.measured_readback!==true)codes.push("measured-readback-not-verified");
  if(checks.completion_criterion_digest_verified!==true)
    codes.push("completion-criterion-digest-not-verified");
  if(authorizationBinding!==true)
    codes.push("completion-criterion-not-authorization-bound");
  if(checks.completion_criterion_precommitted!==true)
    codes.push("completion-criterion-not-precommitted");
  if(checks.witness_identified!==true)
    codes.push("physical-witness-not-identified");
  if(checks.observation_method_verified!==true)
    codes.push("observation-method-not-verified");
  if(checks.observation_window_verified!==true)
    codes.push("observation-window-not-verified");
  return codes;
}

function appraisePhysicalCompletion(vector={}){
  if(!vector||vector.schema_version!==SCHEMA){
    return {
      verdict:"invalid",
      codes:["physical-completion-vector-schema-invalid"],
      result:null,
      tiers:[]
    };
  }
  const receipt=vector.physical_receipt;
  const authorized=vector.authorized_completion_criterion;
  if(!receipt||typeof receipt!=="object"||!authorized||typeof authorized!=="object"){
    return {
      verdict:"invalid",
      codes:["physical-completion-vector-required-member-missing"],
      result:null,
      tiers:[]
    };
  }

  let row;
  try{
    row=physicalEvidenceRow(receipt,0);
  }catch(e){
    return {
      verdict:"invalid",
      codes:["physical-completion-vector-evidence-malformed"],
      result:null,
      tiers:[]
    };
  }

  const authorizedCriterion=authorized.criterion;
  const authorizedSha=authorized.criterion_sha256;
  const authorizationBinding=
    !!authorizedCriterion&&
    /^[0-9a-f]{64}$/.test(String(authorizedSha||""))&&
    digestObject(authorizedCriterion)===authorizedSha&&
    row.completion_criterion_sha256===authorizedSha&&
    digestObject(row.completion_criterion||{})===authorizedSha;

  const codes=codeSet(row,authorizationBinding);
  const integrityFailure=codes.some(code=>[
    "target-binding-not-verified",
    "hardware-identity-not-stable",
    "completion-criterion-digest-not-verified",
    "completion-criterion-not-authorization-bound"
  ].includes(code));

  if(integrityFailure){
    return {
      verdict:"invalid",
      codes,
      result:null,
      tiers:[]
    };
  }

  const witnessTier=
    row.checks.witness_identified===true&&
    row.checks.fresh_readback_verified===true&&
    row.checks.measured_readback===true&&
    row.checks.observation_method_verified===true&&
    row.checks.observation_window_verified===true;

  const tiers=witnessTier?["identified-fresh-physical-witness"]:["physical-evidence-unresolved"];

  const prerequisiteCodes=codes.filter(code=>
    code!=="ack-not-verified"
  );

  let result="PHYSICAL_COMPLETION_INDETERMINATE";
  if(
    receipt.status==="applied"&&
    prerequisiteCodes.length===0&&
    row.checks.ack_verified===true
  ){
    result=row.checks.completion_criterion_satisfied===true
      ?"PHYSICAL_COMPLETION_PROVEN"
      :"PHYSICAL_COMPLETION_NOT_SATISFIED";
  }else if(
    receipt.status==="applied"&&
    prerequisiteCodes.length===0&&
    row.checks.ack_verified!==true
  ){
    // A missing/ambiguous ACK does not prove non-execution. Fresh identified
    // measured readback may still resolve completion under the precommitted
    // criterion. This does not establish observer independence.
    result=row.checks.completion_criterion_satisfied===true&&witnessTier
      ?"PHYSICAL_COMPLETION_PROVEN"
      :"PHYSICAL_COMPLETION_INDETERMINATE";
  }

  return {
    verdict:"valid",
    codes,
    result,
    tiers,
    independent_object_outcome_verified:false,
    checks:row.checks
  };
}

function main(argv=process.argv.slice(2)){
  const file=argv[0];
  if(!file){
    process.stdout.write(JSON.stringify({
      verdict:"invalid",
      codes:["physical-completion-vector-path-required"],
      result:null,
      tiers:[]
    })+"\n");
    return 2;
  }
  try{
    const vector=JSON.parse(fs.readFileSync(path.resolve(file),"utf8"));
    const out=appraisePhysicalCompletion(vector);
    process.stdout.write(JSON.stringify(out)+"\n");
    return out.verdict==="valid"?0:1;
  }catch(e){
    process.stdout.write(JSON.stringify({
      verdict:"invalid",
      codes:["physical-completion-vector-unreadable"],
      result:null,
      tiers:[]
    })+"\n");
    return 1;
  }
}

if(require.main===module)process.exitCode=main();

module.exports={SCHEMA,appraisePhysicalCompletion,main};
