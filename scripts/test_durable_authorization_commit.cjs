"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {normalizeRuntime,applyTurn}=require("./whole_home_patch_contract.cjs");
const {authorizationDigest,atomicApplyAuthorizedPlan}=require("./atomic_authorized_commit.cjs");
const {FileAuthorizationLedger}=require("./authorization_ledger.cjs");

const target={area:"客厅",entity:"空调",instance:"default"};
let runtime=normalizeRuntime();
runtime=applyTurn(runtime,{op:"ADD_DEVICE",target,slots:{temperature:24}}).runtime;
const before=JSON.parse(JSON.stringify(runtime));
const patches=[{target:"客厅::空调::default",model_id:"AWGD-ZA01",slot:"temperature",capability:"temperature",value:22}];
const registryDigest="registry-v1";
const planner={
 ok:true,patches,
 authorization:{version:1,authorization_id:"restart-e2e-auth",turn_id:"turn-restart",patch_digest:authorizationDigest(patches),registry_digest:registryDigest}
};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-restart-e2e-"));
const file=path.join(dir,"authorization-ledger.json");

let ledger=new FileAuthorizationLedger(file);
let out=atomicApplyAuthorizedPlan(runtime,planner,registryDigest,ledger);
assert(out.ok);assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
const committed=JSON.parse(JSON.stringify(out.runtime));

// Simulate executor restart: discard the in-memory object and reload durable evidence.
ledger=new FileAuthorizationLedger(file);
out=atomicApplyAuthorizedPlan(committed,planner,registryDigest,ledger);
assert.equal(out.ok,false);
assert.equal(out.reason,"planner_authorization_replayed");
assert.deepStrictEqual(out.runtime,committed);
assert.equal(out.receipts.length,0);

// Mandatory trust context: neither ledger nor current registry identity can be omitted.
out=atomicApplyAuthorizedPlan(before,planner,registryDigest,null);
assert.equal(out.ok,false);assert.equal(out.reason,"authorization_ledger_required");
out=atomicApplyAuthorizedPlan(before,planner,null,new FileAuthorizationLedger(path.join(dir,"other.json")));
assert.equal(out.ok,false);assert.equal(out.reason,"current_registry_digest_required");

console.log(JSON.stringify({
 durable_commit_replay_boundary:"PASS",
 replay_after_executor_restart:0,
 missing_ledger_bypass:0,
 missing_registry_bypass:0,
 unauthorized_receipt:0
}));
