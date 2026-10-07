"use strict";
const {FileAuthorizationLedger}=require("./authorization_ledger.cjs");
const [file,barrier,id]=process.argv.slice(2);
const ledger=new FileAuthorizationLedger(file);
process.stdout.write("READY\n");
const deadline=Date.now()+5000;
while(!require("fs").existsSync(barrier)){if(Date.now()>deadline)process.exit(3);}
const ok=ledger.reserve(id,{pid:process.pid});
process.stdout.write(ok?"WIN\n":"LOSE\n");
