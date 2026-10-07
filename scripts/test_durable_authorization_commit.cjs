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
runtime=applyTurn(runtime,[{op:"ADD_DEVICE",target,slots:{temperature:24}}]).runtime;
const before=JSON.parse(JSON.stringify(runtime));
const patches=[{target:"客厅::空调::default",model_id:"AWGD-ZA01",slot:"temperature",capability:"temperature",value:22}];
const registryDigest="registry-v1";
const authorizationId="restart-e2e-auth";
const planner={
 ok:true,patches,
 authorization:{version:2,authorization_id:authorizationId,turn_id:"turn-restart",patch_digest:authorizationDigest(patches),registry_digest:registryDigest}
};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-restart-e2e-"));
const file=path.join(dir,"authorization-ledger.json");

let ledger=new FileAuthorizationLedger(file);
const legacy=JSON.parse(JSON.stringify(planner));
legacy.authorization.version=1;
let legacyOut=atomicApplyAuthorizedPlan(runtime,legacy,registryDigest,ledger);
assert.equal(legacyOut.ok,false);
assert.equal(legacyOut.reason,"planner_authorization_missing");
assert.equal(ledger.status(authorizationId),"fresh");

let out=atomicApplyAuthorizedPlan(runtime,planner,registryDigest,ledger);
assert(out.ok);
assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
assert.equal(ledger.status(authorizationId),"consumed");
const committed=JSON.parse(JSON.stringify(out.runtime));

ledger=new FileAuthorizationLedger(file);
assert.equal(ledger.status(authorizationId),"consumed");
out=atomicApplyAuthorizedPlan(committed,planner,registryDigest,ledger);
assert.equal(out.ok,false);
assert.equal(out.reason,"planner_authorization_replayed");
assert.deepStrictEqual(out.runtime,committed);
assert.equal(out.receipts.length,0);

out=atomicApplyAuthorizedPlan(before,planner,registryDigest,null);
assert.equal(out.ok,false);assert.equal(out.reason,"authorization_ledger_required");
out=atomicApplyAuthorizedPlan(before,planner,null,new FileAuthorizationLedger(path.join(dir,"other.json")));
assert.equal(out.ok,false);assert.equal(out.reason,"current_registry_digest_required");

console.log(JSON.stringify({
 durable_commit_replay_boundary:"PASS",
 authorization_version_downgrade_bypass:0,
 durable_consumed_state_after_commit:1,
 durable_consumed_state_after_restart:1,
 replay_after_executor_restart:0,
 missing_ledger_bypass:0,
 missing_registry_bypass:0,
 unauthorized_receipt:0
}));
