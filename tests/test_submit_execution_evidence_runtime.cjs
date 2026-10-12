'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function part(a,b){const i=html.indexOf(a),j=html.indexOf(b,i);assert(i>=0&&j>i,a);return html.slice(i,j)}
const submitCode=part('function submit(','\nfunction addMsg(');
function run(worldDeltas,commit_status,failure_code){
 const state={utteranceHistory:[],sessionEvents:[],trajectoryStep:0};
 const env={state,Date,clone:x=>JSON.parse(JSON.stringify(x)),runtimeTraceSnapshot:()=>({}),
 deltaFor:()=>({op:'CREATE_TASK',turn_id:'1'}),applyDelta:()=>{},settleNeural:()=>({bestLabel:null}),
 executeCurrent:()=>({route:commit_status?'CLARIFY':'THING_MODEL_EXECUTE',worldDeltas,commit_status,failure_code}),
 friendlyTurn:exec=>({detail:'simulated only',blocked:!!exec.commit_status}),telemetryEpisode:()=> 'test',
 syncTrajectory:()=>{},persistSession:()=>true,$:()=>({textContent:''})};
 vm.createContext(env);
 vm.runInContext(submitCode+'\nsubmit("test",{silent:true,restore:true,persist:false})',env);
 assert.equal(state.sessionEvents.length,1);
 return JSON.parse(JSON.stringify(state.sessionEvents[0]));
}
for(const [deltas,status,code,expected] of [
 [[{key:'lamp',after:30}],null,null,'SIMULATED_STATE_CHANGED'],
 [[],null,null,'NO_SIMULATED_WRITE'],
 [[], 'REJECTED_ATOMIC_SIMULATION','EXECUTION_ADAPTER_EXCEPTION','REJECTED_ATOMIC_SIMULATION']]){
 const event=run(deltas,status,code);
 assert.equal(event.execution_evidence.commit_status,expected);
 assert.equal(event.execution_evidence.physical_completion,'UNVERIFIED');
 assert.equal(event.execution_evidence.hardware_ack,'NOT_OBSERVED');
 assert.equal(event.execution_evidence.independent_readback,'NOT_OBSERVED');
 assert.equal(event.execution_evidence.failure_code,code);
}
console.log('PASS submit runtime exports simulation-only receipt for change/no-change/rejection');
