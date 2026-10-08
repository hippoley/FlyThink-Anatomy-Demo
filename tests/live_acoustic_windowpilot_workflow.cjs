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
assert.match(y,/scene_context_path:/);
assert.match(y,/contextual_state_path:/);
assert.match(y,/authorization_ledger_path:/);
assert.match(y,/--spatialruntime-authorize/);
assert.match(y,/repository:\s*hippoley\/SpatialRuntime/);
assert.match(y,/pip install -e "_spatialruntime"/);
assert.match(y,/--expected-hardware-identity/);
assert.match(y,/--apply/);
assert.match(y,/verify_execution_proof_bundle_cli\.cjs/);
assert.doesNotMatch(y,/verify_acoustic_windowpilot_evidence\.cjs/);
assert.match(y,/--require-human-fixture/);


const dryStart=y.indexOf("DRY_RUN human WAV");
const applyStart=y.indexOf("APPLY human WAV");
const verifyStart=y.indexOf("Independently verify human acoustic + hardware evidence");
const attestStart=y.indexOf("Attest validated live evidence provenance");
assert.ok(dryStart>=0&&applyStart>dryStart&&verifyStart>applyStart&&attestStart>verifyStart);

const dryBlock=y.slice(dryStart,applyStart);
const applyBlock=y.slice(applyStart,verifyStart);
const verifyBlock=y.slice(verifyStart,attestStart);
assert.match(dryBlock,/--spatialruntime-authorize/);
assert.match(dryBlock,/--scene-context/);
assert.match(applyBlock,/--spatialruntime-authorize/);
assert.match(applyBlock,/--scene-context/);
assert.match(applyBlock,/--apply/);
assert.match(applyBlock,/--contextual-state/);
assert.match(applyBlock,/--authorization-ledger/);
assert.match(applyBlock,/--proof-bundle/);
assert.match(verifyBlock,/verify_execution_proof_bundle_cli\.cjs/);
assert.match(verifyBlock,/verifyExecutionReceipt/);
assert.match(verifyBlock,/physical_completion_verified/);
assert.match(verifyBlock,/bundle\.artifacts\.contextual_state/);
assert.match(verifyBlock,/bundle\.artifacts\.before_runtime/);

assert.match(y,/probe_open_pct must be in \(0,5\]/);
assert.match(y,/tolerance_pct must be in \[0,2\]/);
assert.match(y,/probe_open_pct must exceed tolerance_pct/);
assert.match(y,/physical-lab-windowpilot/);
assert.match(y,/cancel-in-progress:\s*false/);

assert.match(y,/id-token:\s*write/);
assert.match(y,/attestations:\s*write/);
assert.match(y,/artifact-metadata:\s*write/);
assert.match(y,/uses:\s*actions\/attest@v4/);
assert.match(y,/live-execution-receipt\.json/);
assert.match(y,/live-execution-proof-bundle\.json/);
assert.match(y,/live-execution-proof-verification\.json/);
assert.match(y,/expected_hardware_identity must be exactly 64 hex characters/);
assert.match(y,/live scene context must contain verified handoff evidence/);
assert.match(y,/live physical target is not a reviewed exterior window in scene context/);
assert.match(y,/context_state_sha256_mismatch|contextStateIdentity/);
assert.match(y,/authorization_ledger_path must be absolute/);
assert.match(y,/authorization ledger parent must be writable/);

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
  contract:"manual self-hosted physical-lab acceptance produces a canonical execution receipt and proof bundle, verifies physical completion, and Sigstore-attests the candidate evidence"
}));
