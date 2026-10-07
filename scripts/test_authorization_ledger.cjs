"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {FileAuthorizationLedger}=require("./authorization_ledger.cjs");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-auth-ledger-"));
const file=path.join(dir,"consumed.json");
const id="auth-restart-proof";

const first=new FileAuthorizationLedger(file);
assert.equal(first.has(id),false);
assert.equal(first.add(id,{turn_id:"turn-1"}),true);
assert.equal(first.has(id),true);

const restarted=new FileAuthorizationLedger(file);
assert.equal(restarted.has(id),true);
assert.equal(restarted.add(id,{turn_id:"turn-1"}),false);

const mode=fs.statSync(file).mode & 0o777;
assert.equal(mode,0o600);

console.log(JSON.stringify({
 durable_authorization_ledger:"PASS",
 replay_after_process_restart:0,
 duplicate_consumption:0,
 ledger_mode:mode.toString(8)
}));
