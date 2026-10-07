"use strict";

const fs=require("fs");
const {validateReceipt}=require("./acoustic_windowpilot_evidence.cjs");

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}
function flag(name){return process.argv.includes(name)}

const path=arg("--receipt");
if(!path)throw new Error("--receipt is required");
const receipt=JSON.parse(fs.readFileSync(path,"utf8"));
const report=validateReceipt(receipt,{
  requireHumanFixture:flag("--require-human-fixture")
});
console.log(JSON.stringify(report,null,2));
if(!report.valid)process.exitCode=2;
