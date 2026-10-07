"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawn}=require("child_process");

const root=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-auth-race-"));
const worker=path.join(__dirname,"authorization_reserve_worker.cjs");
const ROUNDS=40;

function child(file,id,barrier){
  const p=spawn(process.execPath,[worker,file,id,barrier],{stdio:["ignore","pipe","pipe"]});
  let out="",err="",readyResolve;
  const ready=new Promise(r=>readyResolve=r);
  p.stdout.on("data",d=>{out+=d; if(out.includes("READY\n"))readyResolve();});
  const done=new Promise((resolve,reject)=>{
    p.stderr.on("data",d=>err+=d);
    p.on("exit",code=>code===0?resolve(out.trim().split(/\s+/).at(-1)):reject(new Error(err||"worker_exit_"+code)));
  });
  return {ready,done};
}

(async()=>{
  for(let round=0;round<ROUNDS;round++){
    const dir=path.join(root,String(round));fs.mkdirSync(dir);
    const file=path.join(dir,"ledger.json"),barrier=path.join(dir,"GO"),id="same-auth-"+round;
    const a=child(file,id,barrier),b=child(file,id,barrier);
    await Promise.all([a.ready,b.ready]);
    fs.writeFileSync(barrier,"go\n");
    const results=await Promise.all([a.done,b.done]);
    assert.equal(results.filter(x=>x==="WIN").length,1,"round "+round+": exactly one winner required: "+results);
    assert.equal(results.filter(x=>x==="LOSE").length,1,"round "+round+": exactly one loser required: "+results);
    const parsed=JSON.parse(fs.readFileSync(file,"utf8"));
    assert.equal(parsed.authorizations[id].status,"reserved");
  }
  console.log(JSON.stringify({cross_process_reservation_race:"PASS",rounds:ROUNDS,double_winner:0,corrupt_ledger:0}));
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
