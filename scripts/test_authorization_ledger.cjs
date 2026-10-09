"use strict";
const assert=require("assert");
const {spawn}=require("child_process");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {FileAuthorizationLedger}=require("./authorization_ledger.cjs");

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function waitUntil(predicate,{timeoutMs=5000,intervalMs=10}={}){
  const started=Date.now();
  while(!predicate()){
    if(Date.now()-started>timeoutMs)throw new Error("authorization_ledger_test_timeout");
    await sleep(intervalMs);
  }
}
function runWorker(workerPath,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[workerPath,...args],{
      stdio:["ignore","pipe","pipe"]
    });
    let stdout="",stderr="";
    child.stdout.on("data",c=>stdout+=c);
    child.stderr.on("data",c=>stderr+=c);
    child.on("error",reject);
    child.on("close",code=>{
      if(code!==0){
        reject(new Error("worker_failed:"+code+":"+stderr));
        return;
      }
      resolve(JSON.parse(stdout.trim()));
    });
  });
}

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-auth-ledger-"));
  const file=path.join(dir,"consumed.json");
  const id="auth-restart-proof";

  const first=new FileAuthorizationLedger(file);
  assert.equal(first.has(id),false);

  // Construct a second instance before the first consumption. This reproduces
  // the stale-snapshot shape that previously allowed two processes to return true.
  const stalePeer=new FileAuthorizationLedger(file);
  assert.equal(first.add(id,{turn_id:"turn-1"}),true);
  assert.equal(stalePeer.add(id,{turn_id:"turn-1-race"}),false);
  assert.equal(first.has(id),true);

  const restarted=new FileAuthorizationLedger(file);
  assert.equal(restarted.has(id),true);
  assert.equal(restarted.add(id,{turn_id:"turn-1"}),false);

  // Reservation is authoritative. Losing the JSON snapshot must not resurrect
  // an already-consumed authorization after restart.
  fs.writeFileSync(
    file,
    JSON.stringify({version:1,consumed:{}},null,2)+"\n",
    {encoding:"utf8",mode:0o600}
  );
  const snapshotLost=new FileAuthorizationLedger(file);
  assert.equal(snapshotLost.has(id),true);
  assert.equal(snapshotLost.add(id,{turn_id:"must-not-replay"}),false);

  // A second, different ID remains consumable without a global writer lock.
  // The append-only per-ID journal avoids stale-lock availability debt.
  const independentId="auth-independent";
  assert.equal(snapshotLost.add(independentId,{turn_id:"parallel-safe"}),true);
  assert.equal(snapshotLost.has(independentId),true);

  // True multi-process race: every worker constructs its ledger before a common
  // gate opens. Exactly one process may consume the same ID.
  const raceFile=path.join(dir,"race.json");
  const gate=path.join(dir,"race.gate");
  const workerPath=path.join(dir,"ledger-worker.cjs");
  const modulePath=path.resolve(__dirname,"authorization_ledger.cjs");
  fs.writeFileSync(workerPath,`
"use strict";
const fs=require("fs");
const {FileAuthorizationLedger}=require(process.argv[2]);
const file=process.argv[3],id=process.argv[4],ready=process.argv[5],gate=process.argv[6];
const ledger=new FileAuthorizationLedger(file);
fs.writeFileSync(ready,"ready");
const cell=new Int32Array(new SharedArrayBuffer(4));
while(!fs.existsSync(gate))Atomics.wait(cell,0,0,5);
let result;
try{
  result={ok:true,consumed:ledger.add(id,{worker:process.pid})};
}catch(err){
  result={ok:false,error:String(err&&err.message||err)};
}
process.stdout.write(JSON.stringify(result));
`);

  const raceId="auth-real-concurrency";
  const workers=[];
  const readyPaths=[];
  for(let i=0;i<8;i++){
    const ready=path.join(dir,"ready-"+i);
    readyPaths.push(ready);
    workers.push(runWorker(workerPath,[
      modulePath,raceFile,raceId,ready,gate
    ]));
  }
  await waitUntil(()=>readyPaths.every(p=>fs.existsSync(p)));
  fs.writeFileSync(gate,"go");
  const results=await Promise.all(workers);
  const winners=results.filter(x=>x.ok&&x.consumed===true);
  const duplicates=results.filter(x=>x.ok&&x.consumed===false);
  const unexpectedErrors=results.filter(x=>!x.ok);
  assert.equal(winners.length,1,JSON.stringify(results));
  assert.equal(duplicates.length,7,JSON.stringify(results));
  assert.equal(unexpectedErrors.length,0,JSON.stringify(results));
  assert.equal(new FileAuthorizationLedger(raceFile).has(raceId),true);
  const journalNames=fs.readdirSync(raceFile+".reservations");
  assert.equal(journalNames.filter(name=>name.endsWith(".json")).length,1);
  assert.equal(journalNames.filter(name=>name.startsWith(".tmp-")).length,0);

  const mode=fs.statSync(file).mode & 0o777;
  const reservationDirMode=fs.statSync(file+".reservations").mode & 0o777;
  assert.equal(mode,0o600);
  assert.equal(reservationDirMode,0o700);

  console.log(JSON.stringify({
    durable_authorization_ledger:"PASS",
    replay_after_process_restart:0,
    stale_snapshot_double_consume:0,
    snapshot_loss_replay:0,
    global_stale_lock_dependency:0,
    multiprocess_workers:results.length,
    multiprocess_winners:winners.length,
    duplicate_consumption:0,
    ledger_mode:mode.toString(8),
    reservation_dir_mode:reservationDirMode.toString(8)
  }));
})().catch(e=>{console.error(e);process.exit(1)});
