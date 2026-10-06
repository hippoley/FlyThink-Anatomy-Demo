"use strict";
const assert=require("assert");
const {evaluateCommit}=require("../scripts/commit_gate.cjs");

const patch=[{op:"PATCH_SLOT",target:{area:"客厅",entity:"窗",instance:"default"},slot:"opening",value:50}];

assert.deepEqual(
  evaluateCommit({decision:"EXECUTE",patches:patch,commit_state:"safe_to_commit"}),
  {allow:true,deferred:false,reason:"safe_to_commit",commit_state:"safe_to_commit"}
);

for(const state of ["unstable","partial","tentative","streaming","hypothesis"]){
  const g=evaluateCommit({decision:"EXECUTE",patches:patch,commit_state:state});
  assert.equal(g.allow,false);
  assert.equal(g.deferred,true);
  assert.equal(g.reason,"semantic_hypothesis_not_committed");
}

{
  const g=evaluateCommit({decision:"EXECUTE",patches:patch,commit_state:"mystery"});
  assert.equal(g.allow,false);
  assert.equal(g.deferred,true);
  assert.equal(g.reason,"unknown_commit_state");
}

assert.equal(evaluateCommit({decision:"EXECUTE",patches:[],commit_state:"safe_to_commit"}).allow,false);
assert.equal(evaluateCommit({decision:"CLARIFY",patches:patch,commit_state:"safe_to_commit"}).allow,false);

{
  const g=evaluateCommit({decision:"EXECUTE",patches:patch,commit_state:"stable",mode:"streaming"});
  assert.equal(g.allow,false);
  assert.equal(g.deferred,true);
}
{
  const g=evaluateCommit({decision:"EXECUTE",patches:patch,commit_state:"final",mode:"streaming"});
  assert.equal(g.allow,true);
}

// A semantic proposal based on an old world-state revision must not execute,
// even when its semantic commit state is otherwise final.
{
  const g=evaluateCommit({
    decision:"EXECUTE",patches:patch,commit_state:"final",mode:"streaming",
    base_revision:41,current_revision:42
  });
  assert.equal(g.allow,false);
  assert.equal(g.deferred,false);
  assert.equal(g.reason,"stale_base_revision");
  assert.equal(g.base_revision,41);
  assert.equal(g.current_revision,42);
}

// Matching revisions preserve normal execution.
{
  const g=evaluateCommit({
    decision:"EXECUTE",patches:patch,commit_state:"final",mode:"streaming",
    base_revision:42,current_revision:42
  });
  assert.equal(g.allow,true);
}

console.log(JSON.stringify({
  ok:true,
  contracts:[
    "semantic hypothesis != committed mutation",
    "stale world-state revision != committed mutation"
  ]
}));
