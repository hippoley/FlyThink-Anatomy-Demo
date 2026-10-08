"use strict";

const fs=require("fs");
const crypto=require("crypto");
const {
  appraisePhysicalCompletion
}=require("../../scripts/verify_physical_completion_vector_cli.cjs");

const PROVENANCE_FIXED=new Set([
  "OBSERVED VIA GATEWAY",
  "LOGGED BY AGENT"
]);

function sha256(s){
  return crypto.createHash("sha256").update(Buffer.from(s,"utf8")).digest("hex");
}

function verifyAerCore(receipt={}){
  const codes=[];
  const id=String(receipt.id||"");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    codes.push("aer-id-invalid");
  if(typeof receipt.receipt_schema_version!=="string"||!receipt.receipt_schema_version)
    codes.push("aer-schema-version-missing");
  const ts=Date.parse(String(receipt.created_at||""));
  if(!Number.isFinite(ts))codes.push("aer-created-at-invalid");
  if(!receipt.tool||typeof receipt.tool!=="object")
    codes.push("aer-tool-invalid");
  else{
    for(const k of ["name","version","scope"]){
      if(typeof receipt.tool[k]!=="string"||!receipt.tool[k])
        codes.push("aer-tool-"+k+"-invalid");
    }
  }
  const provenance=String(receipt.provenance_class||"");
  if(
    !PROVENANCE_FIXED.has(provenance)&&
    !/^EXECUTED BY .+/.test(provenance)
  )codes.push("aer-provenance-invalid");
  if(typeof receipt.canonical_bytes!=="string")
    codes.push("aer-canonical-bytes-invalid");
  const expectedHash="sha256:"+sha256(String(receipt.canonical_bytes||""));
  if(String(receipt.output_hash||"")!==expectedHash)
    codes.push("aer-output-hash-mismatch");
  return {
    verdict:codes.length?"invalid":"valid",
    codes,
    output_hash_verified:codes.includes("aer-output-hash-mismatch")===false
  };
}

function combinedClaims(aer,physical){
  return {
    aer_observed_execution_record:aer.verdict==="valid",
    physical_completion:
      physical.verdict==="valid"&&
      physical.result==="PHYSICAL_COMPLETION_PROVEN",
    physical_outcome_indeterminate:
      physical.verdict==="valid"&&
      physical.result==="PHYSICAL_COMPLETION_INDETERMINATE",
    claim_inheritance:false
  };
}

function checkExpected(actual,expected){
  const errors=[];
  if(actual.aer.verdict!==expected.aer.verdict)
    errors.push("aer verdict");
  if(expected.aer.code&&!actual.aer.codes.includes(expected.aer.code))
    errors.push("aer code "+expected.aer.code);
  if(actual.physical.verdict!==expected.physical.verdict)
    errors.push("physical verdict");
  if(
    Object.prototype.hasOwnProperty.call(expected.physical,"result")&&
    actual.physical.result!==expected.physical.result
  )errors.push("physical result");
  if(expected.physical.code&&!actual.physical.codes.includes(expected.physical.code))
    errors.push("physical code "+expected.physical.code);
  for(const [k,v] of Object.entries(expected.combined_claims||{})){
    if(actual.combined_claims[k]!==v)errors.push("combined "+k);
  }
  return errors;
}

function runFixture(doc={}){
  if(doc.fixture_version!=="aer1-flythink-claim-scope-interop.v0.1")
    throw new Error("fixture_version_invalid");
  const rows=[];
  for(const c of doc.cases||[]){
    const aer=verifyAerCore(c.aer_receipt);
    const physical=appraisePhysicalCompletion(c.physical_vector);
    const actual={
      aer,
      physical:{
        verdict:physical.verdict,
        codes:physical.codes||[],
        result:physical.result||null,
        tiers:physical.tiers||[]
      }
    };
    actual.combined_claims=combinedClaims(aer,physical);
    const errors=checkExpected(actual,c.expected||{});
    rows.push({
      id:c.id,
      pass:errors.length===0,
      errors,
      actual,
      expected:c.expected
    });
  }
  return {
    fixture_version:doc.fixture_version,
    cases:rows,
    pass:rows.length>0&&rows.every(x=>x.pass),
    invariant:"binding without claim inheritance"
  };
}

function main(argv=process.argv.slice(2)){
  const file=argv[0]||"interop/aer1-physical-completion/fixture.v0.1.json";
  const doc=JSON.parse(fs.readFileSync(file,"utf8"));
  const result=runFixture(doc);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  return result.pass?0:1;
}

if(require.main===module)process.exitCode=main();

module.exports={verifyAerCore,combinedClaims,runFixture,main};
