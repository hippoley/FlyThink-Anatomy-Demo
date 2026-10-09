"use strict";

const fs=require("fs");
const path=require("path");
const {spawnSync}=require("child_process");

const MAX_STDIN_BYTES=1024*1024;
const MAX_WORKER_OUTPUT_BYTES=1024*1024;
const DENIAL_CODES=new Set([
  "malformed_input","unsupported_version","invalid_bundle","invalid_proof",
  "untrusted_root","delegation_invalid","invalid_signature","request_mismatch",
  "model_mismatch","unknown_capability","scope_exceeded","expired",
  "nonce_missing","nonce_replayed","internal_error"
]);

function deny(code,message){
  return {
    verdict:"deny",
    kind:"external",
    code,
    message:String(message||code)
  };
}
function emit(body){
  process.stdout.write(JSON.stringify(body)+"\n");
}
function readBoundedStdin(){
  const chunks=[];
  let total=0;
  for(;;){
    const chunk=Buffer.allocUnsafe(65536);
    const n=fs.readSync(0,chunk,0,chunk.length,null);
    if(n===0)break;
    total+=n;
    if(total>MAX_STDIN_BYTES)return {ok:false,reason:"oversize"};
    chunks.push(chunk.subarray(0,n));
  }
  return {ok:true,raw:Buffer.concat(chunks)};
}
function parsePrivateVerdict(raw){
  const text=String(raw||"");
  const trimmed=text.endsWith("\n")?text.slice(0,-1):text;
  if(!trimmed||trimmed.includes("\n"))throw new Error("private_verdict_not_single_object");
  let doc;
  try{doc=JSON.parse(trimmed)}
  catch{throw new Error("private_verdict_invalid_json")}
  if(!doc||typeof doc!=="object"||Array.isArray(doc))
    throw new Error("private_verdict_not_object");

  if(doc.verdict==="allow"){
    const keys=Object.keys(doc).sort();
    const expected=["kind","verdict"];
    if(JSON.stringify(keys)!==JSON.stringify(expected))
      throw new Error("private_allow_schema_invalid");
    if(doc.kind!=="external")throw new Error("private_allow_kind_invalid");
    return doc;
  }

  if(doc.verdict==="deny"){
    const keys=Object.keys(doc).sort();
    const allowed=new Set(["verdict","kind","code","message","detail"]);
    if(keys.some(k=>!allowed.has(k)))throw new Error("private_deny_schema_invalid");
    if(!keys.includes("code")||!keys.includes("message"))
      throw new Error("private_deny_required_field_missing");
    if(doc.kind!=="external")throw new Error("private_deny_kind_invalid");
    if(!DENIAL_CODES.has(doc.code))throw new Error("private_deny_code_invalid");
    if(typeof doc.message!=="string")throw new Error("private_deny_message_invalid");
    if(
      doc.detail!=null&&
      (typeof doc.detail!=="object"||Array.isArray(doc.detail))
    )throw new Error("private_deny_detail_invalid");
    return doc;
  }

  throw new Error("private_verdict_value_invalid");
}

function runWorker(raw){
  const worker=path.join(__dirname,"evc_physical_completion_worker.cjs");
  return spawnSync(process.execPath,[worker],{
    input:raw,
    encoding:"utf8",
    maxBuffer:MAX_WORKER_OUTPUT_BYTES,
    stdio:["pipe","pipe","inherit","pipe"],
    env:process.env
  });
}

function main(){
  const input=readBoundedStdin();
  if(!input.ok){
    emit(deny("malformed_input","stdin exceeds the 1 MiB verifier input bound"));
    return 0;
  }

  let child;
  try{child=runWorker(input.raw)}
  catch{
    emit(deny("internal_error","verifier worker could not be started"));
    return 1;
  }

  // EVC-02 load-bearing boundary: anything the worker or a native dependency
  // writes to fd1 is diagnostic noise, never host-facing verdict data.
  if(child.stdout)process.stderr.write(String(child.stdout));

  if(child.error){
    emit(deny("internal_error","verifier worker transport failed"));
    return 1;
  }

  let verdict;
  try{
    verdict=parsePrivateVerdict(
      child.output&&child.output.length>3?child.output[3]:""
    );
  }catch{
    emit(deny("internal_error","private verdict channel was missing or invalid"));
    return 1;
  }

  if(child.signal||child.status!==0){
    if(verdict.code!=="internal_error"){
      verdict=deny("internal_error","verifier worker exited abnormally");
    }
    emit(verdict);
    return 1;
  }

  emit(verdict);
  return 0;
}

if(require.main===module)process.exitCode=main();

module.exports={
  MAX_STDIN_BYTES,
  MAX_WORKER_OUTPUT_BYTES,
  parsePrivateVerdict,
  runWorker,
  main
};
