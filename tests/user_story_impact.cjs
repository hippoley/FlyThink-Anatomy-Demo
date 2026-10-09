"use strict";
const assert=require("assert");
const path=require("path");
const {loadGraph,impact,matches}=require("../scripts/user_story_impact.cjs");

const graph=loadGraph(path.join(__dirname,"..","contracts","user-story-impact.v1.json"));
assert.equal(matches("interop/kontxt-txntoken-trust/**","interop/kontxt-txntoken-trust/profile.go"),true);
assert.equal(matches("scripts/*.cjs","scripts/a.cjs"),true);
assert.equal(matches("scripts/*.cjs","scripts/nested/a.cjs"),false);

{
  const out=impact(graph,["scripts/authorization_ledger.cjs"]);
  assert.ok(out.direct_stories.includes("execution.authorization_replay"));
  assert.ok(out.impacted_stories.includes("execution.transaction_trust"));
  assert.ok(out.impacted_stories.includes("execution.golden_proof"));
  assert.ok(out.impacted_stories.includes("home.undo"));
  assert.ok(out.regression_suites.includes("authorization-ledger"));
  assert.ok(out.regression_suites.includes("proof-bundle"));
}
{
  const out=impact(graph,["scripts/physical_runtime.cjs"]);
  assert.ok(out.direct_stories.includes("execution.quarantine"));
  assert.ok(out.impacted_stories.includes("execution.physical_completion"));
  assert.ok(out.impacted_stories.includes("execution.proof_bundle"));
  assert.ok(out.impacted_stories.includes("execution.claim_scope"));
}
{
  const out=impact(graph,["scripts/contextual_edge_slu_adapter.cjs"]);
  assert.ok(out.direct_stories.includes("context.identity"));
  assert.ok(out.impacted_stories.includes("home.coreference_clarification"));
  assert.ok(out.impacted_stories.includes("execution.untrusted_reasoner_boundary"));
}
{
  const out=impact(graph,["README.md"]);
  assert.deepEqual(out.direct_stories,[]);
  assert.deepEqual(out.regression_suites,[]);
}
console.log(JSON.stringify({ok:true,stories:Object.keys(graph.stories).length,contract:"changed paths expand through user-story dependencies into deterministic regression suites"}));
