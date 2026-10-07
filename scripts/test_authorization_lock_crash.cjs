"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawn}=require("child_process");
const {FileAuthorizationLedger}=require("./authorization_ledger.cjs");

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-lock-crash-"));
  const file=path.join(dir,"ledger.json");
  const lock=file+".lock";
  const child=spawn(process.execPath,[path.join(__dirname,"authorization_lock_holder.cjs"),file],{stdio:["ignore","pipe","pipe"]});
  let out="";
  child.stdout.on("data",d=>out+=d);
  const deadline=Date.now()+3000;
  while(!out.includes("LOCKED")){
    assert(Date.now()<deadline,"holder did not acquire lock");
    await new Promise(r=>setTimeout(r,5));
  }
  assert(fs.existsSync(lock));

  const contender=new FileAuthorizationLedger(file,{lockTimeoutMs:30,lockRetryMs:2});
  assert.throws(()=>contender.reserve("must-not-steal"),/authorization_ledger_lock_timeout/);
  assert(fs.existsSync(lock),"live owner lock must not be removed");

  child.kill("SIGKILL");
  await new Promise(resolve=>child.once("close",resolve));
  assert(fs.existsSync(lock),"SIGKILL should leave stale lock artifact");

  const recovered=new FileAuthorizationLedger(file,{lockTimeoutMs:1000,lockRetryMs:2});
  assert.equal(recovered.reserve("after-crash",{recovered:true}),true);
  assert.equal(recovered.status("after-crash"),"reserved");
  assert.equal(fs.existsSync(lock),false,"recovered transaction must release lock");

  console.log(JSON.stringify({
    authorization_lock_crash_recovery:"PASS",
    live_lock_stolen:0,
    stale_dead_owner_recovered:1,
    post_crash_reservation:1
  }));
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
