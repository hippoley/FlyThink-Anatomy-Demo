"use strict";

const assert=require("assert");
const fs=require("fs");
const path=require("path");

const file=path.join(
  __dirname,"..",".github","workflows","live-acoustic-windowpilot-acceptance.yml"
);
const y=fs.readFileSync(file,"utf8");

assert.match(y,/name:\s*live-acoustic-windowpilot-acceptance/);
assert.match(y,/workflow_dispatch:/);
assert.doesNotMatch(y,/\n\s*push:/);
assert.doesNotMatch(y,/\n\s*pull_request:/);

assert.match(y,/runs-on:\s*\[self-hosted, linux\]/);
assert.match(y,/environment:\s*physical-lab/);
assert.match(y,/confirm_apply:/);
assert.match(y,/APPLY_REAL_HARDWARE/);

assert.match(y,/--require-human-fixture/);
assert.match(y,/--expected-hardware-identity/);
assert.match(y,/--apply/);
assert.match(y,/verify_acoustic_windowpilot_evidence\.cjs/);
assert.match(y,/--require-human-fixture/);

assert.match(y,/probe_open_pct must be in \(0,5\]/);
assert.match(y,/tolerance_pct must be in \[0,2\]/);
assert.match(y,/probe_open_pct must exceed tolerance_pct/);
assert.match(y,/physical-lab-windowpilot/);
assert.match(y,/cancel-in-progress:\s*false/);

assert.match(y,/id-token:\s*write/);
assert.match(y,/attestations:\s*write/);
assert.match(y,/artifact-metadata:\s*write/);
assert.match(y,/uses:\s*actions\/attest@v4/);
assert.match(y,/live-acoustic-windowpilot-receipt\.json/);
assert.match(y,/expected_hardware_identity must be exactly 64 hex characters/);

const artifactBlock=y.slice(y.indexOf("name: live-acoustic-windowpilot-evidence"));
assert.ok(artifactBlock.length>0,"evidence artifact block missing");
assert.doesNotMatch(
  artifactBlock,
  /\$\{\{\s*inputs\.wav_path\s*\}\}/,
  "human WAV must never be uploaded as an artifact"
);
assert.doesNotMatch(
  artifactBlock,
  /\$\{\{\s*inputs\.fixture_manifest_path\s*\}\}/,
  "operator-local fixture manifest must remain local; receipt contains hashes"
);

console.log(JSON.stringify({
  ok:true,
  contract:"manual self-hosted human-acoustic WindowPilot acceptance remains fail-closed and validated evidence is Sigstore-attested"
}));
