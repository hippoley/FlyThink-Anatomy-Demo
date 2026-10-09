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

// Construct a second instance before the first consumption. This reproduces the
// stale-snapshot shape that previously allowed two processes to both return true.
const stalePeer=new FileAuthorizationLedger(file);
assert.equal(first.add(id,{turn_id:"turn-1"}),true);
assert.equal(stalePeer.add(id,{turn_id:"turn-1-race"}),false);
assert.equal(first.has(id),true);

const restarted=new FileAuthorizationLedger(file);
assert.equal(restarted.has(id),true);
assert.equal(restarted.add(id,{turn_id:"turn-1"}),false);

// The per-authorization O_EXCL reservation is the authoritative replay barrier.
// Even if the human-readable JSON snapshot is lost/corrupted back to an empty
// valid snapshot, restart must still fail closed on the retained reservation.
fs.writeFileSync(
  file,
  JSON.stringify({version:1,consumed:{}},null,2)+"\n",
  {encoding:"utf8",mode:0o600}
);
const snapshotLost=new FileAuthorizationLedger(file);
assert.equal(snapshotLost.has(id),true);
assert.equal(snapshotLost.add(id,{turn_id:"must-not-replay"}),false);

// A contended/global writer lock must fail closed before a new reservation can
// be created. No caller may "best effort" its way across the replay boundary.
const blockedId="auth-lock-contention";
fs.writeFileSync(
  file+".lock",
  JSON.stringify({version:1,pid:999999,acquired_at:"test"})+"\n",
  {encoding:"utf8",mode:0o600}
);
assert.throws(
  ()=>snapshotLost.add(blockedId,{turn_id:"blocked"}),
  /authorization_ledger_locked/
);
assert.equal(snapshotLost.has(blockedId),false);
fs.unlinkSync(file+".lock");

assert.equal(snapshotLost.add(blockedId,{turn_id:"after-lock-release"}),true);
assert.equal(snapshotLost.has(blockedId),true);

const mode=fs.statSync(file).mode & 0o777;
const reservationDirMode=fs.statSync(file+".reservations").mode & 0o777;
assert.equal(mode,0o600);
assert.equal(reservationDirMode,0o700);

console.log(JSON.stringify({
  durable_authorization_ledger:"PASS",
  replay_after_process_restart:0,
  stale_snapshot_double_consume:0,
  snapshot_loss_replay:0,
  lock_contention_fail_open:0,
  duplicate_consumption:0,
  ledger_mode:mode.toString(8),
  reservation_dir_mode:reservationDirMode.toString(8)
}));
