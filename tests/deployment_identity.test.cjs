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
  html.includes("human-WAV → canonical runtime → WindowPilot proof is still converging in #93."),
  "public page must preserve the real-hardware non-claim"
);

console.log(JSON.stringify({
  ok:true,
  contract:"public first screen exposes execution truth and keeps real-hardware golden proof pending"
}));
