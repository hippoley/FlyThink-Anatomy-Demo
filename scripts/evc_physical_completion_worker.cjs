"use strict";

const fs=require("fs");
const {
  appraisePhysicalCompletion
}=require("./verify_physical_completion_vector_cli.cjs");

const DENIAL_CODES=new Set([
  "malformed_input","unsupported_version","invalid_bundle","invalid_proof",
  "untrusted_root","delegation_invalid","invalid_signature","request_mismatch",
  "model_mismatch","unknown_capability","scope_exceeded","expired",
  "nonce_missing","nonce_replayed","internal_error"
]);

function deny(code,message,detail){
  if(!DENIAL_CODES.has(code))throw new Error("evc_denial_code_invalid");
  const out={verdict:"deny",kind:"external",code,message:String(message||code)};
  if(detail&&typeof detail==="object"&&!Array.isArray(detail))out.detail=detail;
  return out;
}
function allow(){return {verdict:"allow",kind:"external"}}

function validRequestShape(doc){
  if(!doc||typeof doc!=="object"||Array.isArray(doc))return false;
  if(!Number.isInteger(doc.version))return false;
  if(typeof doc.bundle!=="string"||doc.bundle.length===0)return false;
  if(!doc.request||typeof doc.request!=="object"||Array.isArray(doc.request))return false;
  if(!Number.isInteger(doc.now_unix)||doc.now_unix<=0)return false;
  const r=doc.request;
  if(typeof r.agent_name!=="string")return false;
  if(typeof r.project_key!=="string")return false;
  if(typeof r.program!=="string")return false;
  if(typeof r.model!=="string")return false;
  if(
    !Array.isArray(r.granted_capabilities)||
    !r.granted_capabilities.every(x=>typeof x==="string")
  )return false;
  return true;
}

function evaluateEvcRequest(doc){
  if(!validRequestShape(doc)){
    return {
      exitCode:0,
      body:deny(
        "malformed_input",
        "request does not satisfy the EVC v1 wire shape"
      )
    };
  }
  if(doc.version!==1){
    return {
      exitCode:0,
      body:deny("unsupported_version","only EVC wire version 1 is supported")
    };
  }

  let vector;
  try{vector=JSON.parse(doc.bundle)}
  catch{
    return {
      exitCode:0,
      body:deny(
        "invalid_bundle",
        "bundle is not a valid FlyThink physical-completion vector JSON string"
      )
    };
  }

  const required=doc.request.required_precondition;
  if(
    !required||
    typeof required!=="object"||
    Array.isArray(required)||
    required.type!=="physical_completion"||
    typeof required.criterion_sha256!=="string"
  ){
    return {
      exitCode:0,
      body:deny(
        "request_mismatch",
        "request must declare the physical-completion precondition being gated"
      )
    };
  }

  const appraisal=appraisePhysicalCompletion(vector);
  if(appraisal.verdict!=="valid"){
    return {
      exitCode:0,
      body:deny(
        "invalid_proof",
        "physical-completion evidence package failed appraisal",
        {codes:appraisal.codes||[]}
      )
    };
  }

  const authorized=vector.authorized_completion_criterion||{};
  if(required.criterion_sha256!==authorized.criterion_sha256){
    return {
      exitCode:0,
      body:deny(
        "request_mismatch",
        "required criterion does not match the authorization-bound completion criterion"
      )
    };
  }

  if(appraisal.result!=="PHYSICAL_COMPLETION_PROVEN"){
    return {
      exitCode:0,
      body:deny(
        "request_mismatch",
        "required physical-completion precondition is not proven",
        {
          physical_completion_result:appraisal.result,
          physical_completion_codes:appraisal.codes||[]
        }
      )
    };
  }

  return {exitCode:0,body:allow()};
}

function writePrivateVerdict(body){
  fs.writeSync(3,JSON.stringify(body)+"\n");
}

function main(){
  try{
    let raw="";
    for(;;){
      const chunk=Buffer.allocUnsafe(65536);
      const n=fs.readSync(0,chunk,0,chunk.length,null);
      if(n===0)break;
      raw+=chunk.subarray(0,n).toString("utf8");
    }

    if(process.env.FLYTHINK_EVC_TEST_STDOUT_NOISE==="1"){
      // Deliberate fd1 contamination. The parent verifier MUST capture this
      // and forward it to stderr instead of exposing it to the EVC host.
      process.stdout.write("evc-worker-stdout-noise\n");
    }
    if(process.env.FLYTHINK_EVC_TEST_CRASH==="1"){
      throw new Error("synthetic_worker_failure");
    }

    let doc;
    try{doc=JSON.parse(raw)}
    catch{
      writePrivateVerdict(
        deny("malformed_input","request stdin is not valid JSON")
      );
      return 0;
    }

    const out=evaluateEvcRequest(doc);
    writePrivateVerdict(out.body);
    return out.exitCode;
  }catch(e){
    try{
      writePrivateVerdict(
        deny(
          "internal_error",
          "verifier worker failed before a trustworthy decision could be produced"
        )
      );
    }catch(_){}
    return 1;
  }
}

if(require.main===module)process.exitCode=main();

module.exports={
  DENIAL_CODES,
  deny,
  allow,
  validRequestShape,
  evaluateEvcRequest,
  main
};
