"use strict";
const {FileAuthorizationLedger}=require("./authorization_ledger.cjs");
const [file,id,delay]=process.argv.slice(2);
setTimeout(()=>{
  try{
    const ledger=new FileAuthorizationLedger(file);
    const won=ledger.reserve(id,{pid:process.pid});
    process.stdout.write(won?"WIN\n":"LOSE\n");
    process.exit(0);
  }catch(e){
    process.stderr.write(String(e.stack||e)+"\n");
    process.exit(2);
  }
},Number(delay||0));
