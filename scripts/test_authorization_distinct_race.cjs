"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawn}=require("child_process");
const {FileAuthorizationLedger}=require("./authorization_ledger.cjs");
function run(file,barrier,id){
 return new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,[path.join(__dirname,"authorization_distinct_worker.cjs"),file,barrier,id],{stdio:["ignore","pipe","pipe"]});
  let out="",err=""; p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);
  const ready=()=>out.includes("READY");
  const timer=setInterval(()=>{if(ready()){clearInterval(timer);resolve({p,get:()=>out,err:()=>err});}},2);
  p.on("error",reject);
 });
}
(async()=>{
 const rounds=40;
 for(let i=0;i<rounds;i++){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-distinct-race-"));
  const file=path.join(dir,"ledger.json"), barrier=path.join(dir,"GO");
  const [a,b]=await Promise.all([run(file,barrier,"auth-A-"+i),run(file,barrier,"auth-B-"+i)]);
  fs.writeFileSync(barrier,"go");
  await Promise.all([new Promise(r=>a.p.on("close",r)),new Promise(r=>b.p.on("close",r))]);
  assert(a.get().includes("WIN")&&b.get().includes("WIN"),"both distinct reservations must succeed");
  const ledger=new FileAuthorizationLedger(file);
  assert.equal(ledger.status("auth-A-"+i),"reserved");
  assert.equal(ledger.status("auth-B-"+i),"reserved");
 }
 console.log(JSON.stringify({cross_process_distinct_reservations:"PASS",rounds,lost_updates:0}));
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
