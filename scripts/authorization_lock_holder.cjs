"use strict";
const {FileAuthorizationLedger}=require("./authorization_ledger.cjs");
const file=process.argv[2];
const ledger=new FileAuthorizationLedger(file);
ledger._withLock(()=>{
  process.stdout.write("LOCKED\n");
  const wait=new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(wait,0,0);
});
