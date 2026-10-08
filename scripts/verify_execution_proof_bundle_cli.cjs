"use strict";

const fs=require("fs");
const path=require("path");
const {
  verifyExecutionProofBundle
}=require("./execution_proof_bundle.cjs");

function verifyBundleFile(filePath){
  if(!filePath)throw new Error("execution_proof_bundle_path_required");
  const resolved=path.resolve(String(filePath));
  const raw=fs.readFileSync(resolved,"utf8");
  const bundle=JSON.parse(raw);
  return verifyExecutionProofBundle(bundle);
}

function main(argv=process.argv.slice(2)){
  const filePath=argv[0];
  try{
    const verified=verifyBundleFile(filePath);
    process.stdout.write(JSON.stringify({
      verdict:"VERIFIED",
      ...verified
    })+"\n");
    return 0;
  }catch(err){
    process.stdout.write(JSON.stringify({
      verdict:"INVALID",
      error:String(err&&err.message||err)
    })+"\n");
    return 1;
  }
}

if(require.main===module){
  process.exitCode=main();
}

module.exports={verifyBundleFile,main};
