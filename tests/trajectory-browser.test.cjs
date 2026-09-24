const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const code=html.slice(html.indexOf('let telemetryQueue='),html.indexOf('function browserSessionStorage('));
function runtime(host='127.0.0.1',search='?telemetry=local'){
 const calls=[],status={textContent:''};
 const c=vm.createContext({state:{episodeId:'browser:one',sessionEvents:[{event_id:'e1',episode_id:'browser:one',trajectory_step:1}]},window:{location:{hostname:host,search}},URLSearchParams,JSON,Date,Math,$:()=>status,fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true}}});
 vm.runInContext(code,c);return {c,calls,status};
}
test('public site never automatically transmits trajectories',async()=>{
 const {c,calls}=runtime('hippoley.github.io');c.syncTrajectory();await vm.runInContext('telemetryQueue',c);assert.equal(calls.length,0);
});
test('local collection snapshots before reset and preserves ordering',async()=>{
 const {c,calls}=runtime();c.syncTrajectory();c.state.sessionEvents.push({event_id:'e2',episode_id:'browser:one',trajectory_step:2});c.closeTelemetryEpisode();c.state.sessionEvents=[];c.state.episodeId='browser:two';
 await vm.runInContext('telemetryQueue',c);
 assert.equal(calls[0].body.events.length,1);assert.equal(calls[1].body.events.length,2);
 assert.equal(calls[2].url,'/telemetry/finish');assert.equal(calls[2].body.episode_id,'browser:one');
});
test('failed upload remains visible and the next sync retries',async()=>{
 const {c,calls,status}=runtime();c.fetch=async()=>({ok:false});c.syncTrajectory();await vm.runInContext('telemetryQueue',c);assert.match(status.textContent,/尚未同步/);
 c.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true}};c.syncTrajectory();await vm.runInContext('telemetryQueue',c);assert.equal(calls.length,1);assert.equal(calls[0].events[0].event_id,'e1');
});
