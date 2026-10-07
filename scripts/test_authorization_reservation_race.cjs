"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawn}=require("child_process");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-auth-race-"));
const file=path.join(dir,"ledger.json");
const worker=path.join(__dirname,"authorization_reserve_worker.cjs");
const id="same-authorization";

function run(){
  return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[worker,file,id,"0"],{stdio:["ignore","pipe","pipe"]});
    let out="",err="";
    p.stdout.on("data",d=>out+=d);
    p.stderr.on("data",d=>err+=d);
    p.on("exit",code=>code===0?resolve(out.trim()):reject(new Error(err||"worker_exit_"+code)));
  });
}
(async()=>{
  const results=await Promise.all([run(),run()]);
  const wins=results.filter(x=>x==="WIN").length;
  const losses=results.filter(x=>x==="LOSE").length;
  assert.equal(wins,1,"exactly one process must reserve");
  assert.equal(losses,1,"exactly one process must lose");
  console.log(JSON.stringify({cross_process_reservation_race:"PASS",winners:wins,losers:losses}));
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
