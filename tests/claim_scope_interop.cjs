"use strict";

const fs=require("fs");
const assert=require("assert");

const fixture=JSON.parse(
  fs.readFileSync("interop/claim-scope/claim-scope-cases.v0.1.json","utf8")
);

function deriveClaims(evidence={}){
  const claims=[];
  if(evidence.authority==="VERIFIED")claims.push("AUTHORITY_VERIFIED");
  if(evidence.tool_observation==="VERIFIED")claims.push("TOOL_EXECUTION_OBSERVED");
  if(evidence.physical_execution==="VERIFIED_EXECUTED")
    claims.push("PHYSICAL_EFFECT_VERIFIED");
  if(evidence.physical_execution==="VERIFIED_NOT_EXECUTED")
    claims.push("PHYSICAL_NON_EXECUTION_VERIFIED");
  if(evidence.physical_execution==="INDETERMINATE")
    claims.push("PHYSICAL_OUTCOME_INDETERMINATE");
  if(evidence.site_engagement==="VERIFIED")
    claims.push("SITE_ENGAGEMENT_RECORDED");
  return claims.sort();
}

assert.equal(
  fixture.schema,
  "flythink.claim-scope-interop-cases.v0.1"
);
assert.ok(
  String(fixture.note||"").includes("not a receipt schema"),
  "fixture must not masquerade as a protocol"
);
assert.ok(Array.isArray(fixture.cases)&&fixture.cases.length>=6);

for(const row of fixture.cases){
  const derived=deriveClaims(row.evidence);
  assert.deepEqual(
    derived,
    [...row.expected_claims].sort(),
    row.case_id+": expected claim set mismatch"
  );
  for(const forbidden of row.forbidden_claims||[]){
    assert.equal(
      derived.includes(forbidden),
      false,
      row.case_id+": claim laundering: "+forbidden
    );
  }
  assert.equal(
    derived.includes("SAFE_CORRECT_LEGAL"),
    false,
    row.case_id+": evidence composition must not manufacture safety/legal truth"
  );
}

const unresolved=fixture.cases.find(
  x=>x.case_id==="authorized-but-physical-indeterminate"
);
assert.ok(unresolved);
assert.ok(
  unresolved.expected_claims.includes("PHYSICAL_OUTCOME_INDETERMINATE")
);
assert.ok(
  unresolved.forbidden_claims.includes("PHYSICAL_EFFECT_VERIFIED")
);
assert.ok(
  unresolved.forbidden_claims.includes("PHYSICAL_NON_EXECUTION_VERIFIED")
);

const unauthorizedEffect=fixture.cases.find(
  x=>x.case_id==="physical-effect-without-authority"
);
assert.ok(unauthorizedEffect);
assert.ok(
  unauthorizedEffect.expected_claims.includes("PHYSICAL_EFFECT_VERIFIED")
);
assert.ok(
  unauthorizedEffect.forbidden_claims.includes("AUTHORITY_VERIFIED")
);

console.log(JSON.stringify({
  ok:true,
  cases:fixture.cases.length,
  contract:"independent evidence may compose without promoting unsupported claims"
}));
