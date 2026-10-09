"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {inspectTokenetesSource}=require("../scripts/probe_tokenetes_draft11.cjs");

test("legacy Tokenetes-like issuer surface is blocked as a current draft-11 adapter candidate",()=>{
  const source=`
const TOKEN_JWT_HEADER = "txn_token"
jwt.MapClaims{
  "iss": issuer,
  "iat": now,
  "aud": audience,
  "exp": exp,
  "txn": txn,
  "sub": sub,
  "purp": purp,
  "azd": azd,
  "rctx": rctx,
}
`;
  const out=inspectTokenetesSource(source,{upstreamCommit:"fixture"});
  assert.equal(out.draft11_surface_ready,false);
  assert.equal(out.flythink_trust_adapter_candidate,false);
  assert.equal(out.observed.typ_legacy_txn_token,true);
  assert.deepEqual(
    out.missing_required_current_draft_claims.sort(),
    ["req_wl","scope"].sort()
  );
  assert.deepEqual(out.missing_flythink_profile_claims,["tctx"]);
  assert.equal(out.verdict,"BLOCKED_CURRENT_DRAFT_SURFACE");
});

test("current-draft issuer surface still does not become a validator claim",()=>{
  const source=`
const TOKEN_JWT_HEADER = "txntoken+jwt"
jwt.MapClaims{
  "iat": now,
  "aud": audience,
  "exp": exp,
  "txn": txn,
  "sub": sub,
  "scope": scope,
  "tctx": tctx,
  "rctx": rctx,
  "req_wl": workload,
}
`;
  const out=inspectTokenetesSource(source);
  assert.equal(out.draft11_surface_ready,true);
  assert.equal(out.flythink_trust_adapter_candidate,true);
  assert.equal(out.verdict,"READY_FOR_EXTERNAL_VALIDATOR_INTEGRATION");
  assert.match(out.claim_boundary.join(" "),/would not authenticate a token inside FlyThink/);
});

test("presence of tctx cannot compensate for missing required base claims",()=>{
  const source=`
const TOKEN_JWT_HEADER = "txntoken+jwt"
jwt.MapClaims{"iat":1,"aud":"x","exp":2,"txn":"t","sub":"s","tctx":{}}
`;
  const out=inspectTokenetesSource(source);
  assert.equal(out.flythink_trust_adapter_candidate,false);
  assert.ok(out.missing_required_current_draft_claims.includes("scope"));
  assert.ok(out.missing_required_current_draft_claims.includes("req_wl"));
});
