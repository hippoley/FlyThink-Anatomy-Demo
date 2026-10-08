"use strict";

const fs=require("fs");
const assert=require("assert");

const html=fs.readFileSync("index.html","utf8");

for(const token of [
  "async function loadConversationCore()",
  "async function loadAnatomyViews()",
  "async function bootDemo()",
  "conversation demo remains usable",
  "setConversationReady(true)"
]){
  assert.ok(html.includes(token),"missing loading-contract token: "+token);
}

const core=html.slice(
  html.indexOf("async function loadConversationCore()"),
  html.indexOf("async function loadAnatomyViews()")
);
assert.ok(core.includes("neural-substrate.json"));
assert.ok(core.includes("learned-dialogue-model.json"));
assert.ok(core.includes("real-home-thing-model-registry.json"));
assert.ok(core.includes("capability-index.json"));
assert.ok(!core.includes("anatomy-sample.json"));
assert.ok(!core.includes("measured-snapshot.json"));

const optional=html.slice(
  html.indexOf("async function loadAnatomyViews()"),
  html.indexOf("async function bootDemo()")
);
assert.ok(optional.includes("anatomy-sample.json"));
assert.ok(optional.includes("measured-snapshot.json"));
assert.ok(optional.includes("catch(e)"));

console.log(JSON.stringify({
  ok:true,
  contract:"core conversation readiness is independent from optional anatomy assets"
}));
