"use strict";
const fs=require("fs");
const {FileAuthorizationLedger}=require("./authorization_ledger.cjs");
const [file,id,barrier]=process.argv.slice(2);

try{
  const ledger=new FileAuthorizationLedger(file);
  process.stdout.write("READY\n");
  const deadline=Date.now()+5000;
  while(!fs.existsSync(barrier)){
    if(Date.now()>deadline)throw new Error("barrier_timeout");
  }
  const won=ledger.reserve(id,{pid:process.pid});
  process.stdout.write(won?"WIN\n":"LOSE\n");
}catch(e){
  process.stderr.write(String(e.stack||e)+"\n");
  process.exitCode=2;
}
