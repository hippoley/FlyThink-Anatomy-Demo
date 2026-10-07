"use strict";

const assert=require("assert");
const fs=require("fs");

const yaml=fs.readFileSync(".github/workflows/scene-spatial-context-ci.yml","utf8");

assert.match(yaml,/Build and validate latest authored scene handoff/);
assert.match(yaml,/build-spatialruntime-handoff\.py/);
assert.match(yaml,/validate-spatialruntime-handoff\.py/);
assert.match(yaml,/--handoff \/tmp\/interior-handoff\.json/);
assert.match(yaml,/--expected-source-repo hippoley\/interior-kitchen-original/);
assert.match(yaml,/--expected-source-commit "\$UPSTREAM_SHA"/);
assert.match(yaml,/context\['handoff_evidence'\]\['source_commit_sha'\]==upstream_sha/);
assert.match(yaml,/context\['handoff_evidence'\]\['handoff_sha256'\]==handoff\['handoff_sha256'\]/);
assert.match(yaml,/\/tmp\/interior-handoff\.json/);
assert.match(yaml,/Verify pinned SpatialRuntime revision in live consumer/);
assert.match(yaml,/repository_dispatch:/);
assert.match(yaml,/interior-spatialruntime-handoff-updated/);
assert.match(yaml,/schedule:/);
assert.match(yaml,/cron: "17 3 \* \* \*"/);
assert.match(yaml,/github\.event\.client_payload\.source_commit_sha \|\| 'main'/);
assert.match(yaml,/assert upstream_sha==dispatch_sha/);

console.log(JSON.stringify({
  ok:true,
  contract:"live interior scene must flow through verified handoff + pinned source commit before HomeAI scene authorization"
}));
