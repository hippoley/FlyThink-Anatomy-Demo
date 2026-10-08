"use strict";

const fs=require("fs");
const {
  appraisePhysicalCompletion
}=require("./verify_physical_completion_vector_cli.cjs");

const MAX_STDIN_BYTES=1024*1024;

function deny(code,message,detail){
  const out={verdict:"deny",kind:"external",code,message};
  if(detail&&typeof detail==="object")out.detail=detail;
  return out;
}

function allow(){
  return {verdict:"allow",kind:"external"};
}

function validRequestShape(doc){
  if(!doc||typeof doc!=="object"||Array.isArray(doc))return false;
  if(typeof doc.version!=="number")return false;
  if(typeof doc.bundle!=="string"||doc.bundle.length===0)return false;
  if(!doc.request||typeof doc.request!=="object"||Array.isArray(doc.request))return false;
  if(!Number.isInteger(doc.now_unix)||doc.now_unix<=0)return false;
  const r=doc.request;
  if(typeof r.agent_name!=="string")return false;
  if(typeof r.project_key!=="string")return false;
  if(typeof r.program!=="string")return false;
  if(typeof r.model!=="string")return false;
  if(!Array.isArray(r.granted_capabilities)||!r.granted_capabilities.every(x=>typeof x==="string"))
    return false;
  return true;
}

function evaluateEvcRequest(doc){
  if(!validRequestShape(doc))
    return {exitCode:0,body:deny("malformed_input","request does not satisfy EVC v1 required shape")};

  if(doc.version!==1)
    return {exitCode:0,body:deny("unsupported_version","only EVC version 1 is supported")};

  let vector;
  try{
    vector=JSON.parse(doc.bundle);
  }catch{
    return {exitCode:0,body:deny("invalid_bundle","bundle is not a valid physical-completion vector JSON string")};
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

  const required=doc.request.required_precondition;
  if(
    !required||
    typeof required!=="object"||
    required.type!=="physical_completion"||
    typeof required.criterion_sha256!=="string"
  ){
    return {
      exitCode:0,
      body:deny(
        "request_mismatch",
        "request must declare the physical-completion precondition this verifier is gating"
      )
    };
  }

  const authorized=vector.authorized_completion_criterion||{};
  if(required.criterion_sha256!==authorized.criterion_sha256){
    return {
      exitCode:0,
      body:deny(
        "request_mismatch",
        "requested physical-completion criterion does not match the authorized criterion"
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

function main(){
  try{
    const chunks=[];
    let total=0;
    for(;;){
      const chunk=Buffer.allocUnsafe(65536);
      const n=fs.readSync(0,chunk,0,chunk.length,null);
      if(n===0)break;
      total+=n;
      if(total>MAX_STDIN_BYTES){
        process.stdout.write(JSON.stringify(
          deny("malformed_input","stdin exceeds 1 MiB EVC reference bound")
        )+"\n");
        return 0;
      }
      chunks.push(chunk.subarray(0,n));
    }

    let doc;
    try{
      doc=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }catch{
      process.stdout.write(JSON.stringify(
        deny("malformed_input","request stdin is not valid JSON")
      )+"\n");
      return 0;
    }

    const out=evaluateEvcRequest(doc);
    process.stdout.write(JSON.stringify(out.body)+"\n");
    return out.exitCode;
  }catch(e){
    process.stdout.write(JSON.stringify(
      deny("internal_error","verifier failed before a trustworthy decision could be produced")
    )+"\n");
    return 1;
  }
}

if(require.main===module)process.exitCode=main();

module.exports={MAX_STDIN_BYTES,validRequestShape,evaluateEvcRequest,main};
