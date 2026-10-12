'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const match=html.match(/execution_evidence:\{kind:'browser_simulation_only',commit_status:exec\.commit_status\|\|\(\(exec\.worldDeltas\|\|\[\]\)\.length\?'SIMULATED_STATE_CHANGED':'NO_SIMULATED_WRITE'\),failure_code:exec\.failure_code\|\|null,physical_completion:'UNVERIFIED',hardware_ack:'NOT_OBSERVED',independent_readback:'NOT_OBSERVED'\}/);
assert(match,'session event must carry explicit evidence boundary');
const evidence=exec=>({kind:'browser_simulation_only',commit_status:exec.commit_status||((exec.worldDeltas||[]).length?'SIMULATED_STATE_CHANGED':'NO_SIMULATED_WRITE'),failure_code:exec.failure_code||null,physical_completion:'UNVERIFIED',hardware_ack:'NOT_OBSERVED',independent_readback:'NOT_OBSERVED'});
for(const exec of [{worldDeltas:[{key:'x'}]},{worldDeltas:[]},{commit_status:'REJECTED_ATOMIC_SIMULATION',failure_code:'EXECUTION_ADAPTER_EXCEPTION',worldDeltas:[]}]){
 const e=evidence(exec);
 assert.equal(e.physical_completion,'UNVERIFIED');assert.equal(e.hardware_ack,'NOT_OBSERVED');
 assert.equal(e.independent_readback,'NOT_OBSERVED');
 if(exec.failure_code)assert.equal(e.failure_code,exec.failure_code);
}
console.log('PASS simulation receipt cannot claim physical completion');
