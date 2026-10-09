"use strict";

const fs=require("fs");
const assert=require("assert");

const html=fs.readFileSync("index.html","utf8");

for(const token of [
  "Execution Truth for Physical AI",
  "Proof-carrying execution boundary",
  "Agents propose.",
  "Reality responds.",
  "IDENTITY BOUND",
  "INTEGRITY VERIFIABLE",
  "Authorization trust",
  "UNVERIFIED",
  "INDETERMINATE",
  "Real hardware golden",
  "PENDING",
  "Research Playground"
]){
  assert.ok(html.includes(token),"missing deployed identity token: "+token);
}

assert.ok(
  html.indexOf("Execution Truth for Physical AI") <
  html.indexOf("Research Playground"),
  "execution-truth identity must appear before the research playground"
);

assert.ok(
  html.includes("the canonical proof rail is wired; one protected real-device run and retained proof + provenance artifact are still required."),
  "public page must preserve the real-hardware non-claim"
);
assert.ok(
  html.includes("current v1 proves binding/integrity, not an externally governed Trust Domain or signing-key source"),
  "public page must separate local authorization binding from external trust-domain verification"
);
assert.ok(
  !html.includes("issues/93") && !html.includes("converging in #93"),
  "public page must not advertise a superseded convergence issue"
);

console.log(JSON.stringify({
  ok:true,
  contract:"public first screen separates local authorization binding, external trust-domain verification and optional issuer identity while keeping the real-device Golden Proof run pending"
}));
