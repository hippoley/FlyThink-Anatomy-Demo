"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {FileAuthorizationLedger}=require("./authorization_ledger.cjs");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-auth-ledger-"));
const file=path.join(dir,"authorizations.json");
const consumedId="auth-restart-proof";
const releasedId="auth-release-proof";

const first=new FileAuthorizationLedger(file);
assert.equal(first.status(consumedId),"fresh");
assert.equal(first.reserve(consumedId,{turn_id:"turn-1"}),true);
assert.equal(first.status(consumedId),"reserved");
assert.equal(first.reserve(consumedId),false);
assert.equal(first.consume(consumedId,{state_commit:true}),true);
assert.equal(first.status(consumedId),"consumed");
assert.equal(first.consume(consumedId),false);
assert.equal(first.release(consumedId),false);

assert.equal(first.reserve(releasedId,{turn_id:"turn-2"}),true);
assert.equal(first.status(releasedId),"reserved");
assert.equal(first.release(releasedId,"state_commit_failed"),true);
assert.equal(first.status(releasedId),"fresh");

const restarted=new FileAuthorizationLedger(file);
assert.equal(restarted.status(consumedId),"consumed");
assert.equal(restarted.reserve(consumedId),false);
assert.equal(restarted.status(releasedId),"fresh");
assert.equal(restarted.reserve(releasedId),true);

const mode=fs.statSync(file).mode & 0o777;
assert.equal(mode,0o600);

console.log(JSON.stringify({
 durable_authorization_ledger:"PASS",
 lifecycle_transition_errors:0,
 replay_after_process_restart:0,
 duplicate_consumption:0,
 released_reservation_reusable:1,
 ledger_mode:mode.toString(8)
}));
