'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function replayImportedBenchmarkEvidence(doc){');
const b=html.indexOf('\nfunction exportBenchmarkEvidence(){',a);
assert(a>=0&&b>a,'replay function missing');
const source=html.slice(a,b);
function run(cases,failures=['goal_resolution']){
  const state={
    benchmarkScenarios:[],benchmarkResults:[],benchmarkEvidenceOrigin:'generated',
    benchmarkReplayComparison:null,
    clone:x=>JSON.parse(JSON.stringify(x)),
    $:()=>({textContent:''}),
    persistBenchmarkEvidence(){},
    runBenchmark(){
      state.benchmarkResults=state.benchmarkScenarios.map(sc=>({
        turnResults:sc.turns.map(()=>({failures}))
      }));
    }
  };
  vm.createContext(state);
  const doc={schema_version:'flythink.benchmark.evidence.v1',generated_at:'2026-10-12T00:00:00Z',cases};
  return {state,run:()=>vm.runInContext(source+'\nreplayImportedBenchmarkEvidence(doc)',Object.assign(state,{doc}))};
}
const original=[{id:'case-01',family:'goal-to-device-plan',turns:[
  {type:'turn',input:'准备看电影了，客厅有点刺眼',expected:{scenario:true,goal:'movie_comfort'},failure_codes:['goal_resolution']}
]}];
{
  const {state,run:exec}=run(original);
  exec();
  assert.equal(state.benchmarkReplayComparison.changed_count,0);
  assert.equal(state.benchmarkEvidenceOrigin,'replay');
  assert.equal(state.benchmarkScenarios[0].turns[0].expected.goal,'movie_comfort');
}
{
  const {state,run:exec}=run(original,[]);
  exec();
  assert.equal(state.benchmarkReplayComparison.changed_count,1);
  assert.equal(state.benchmarkReplayComparison.changed_turns[0].previous[0],'goal_resolution');
  assert.equal(state.benchmarkReplayComparison.changed_turns[0].current.length,0);
}
{
  const duplicate=[original[0],original[0]];
  const {run:exec}=run(duplicate);
  assert.throws(exec,/案例 ID/);
}
{
  const missing=JSON.parse(JSON.stringify(original));
  delete missing[0].turns[0].expected;
  const {run:exec}=run(missing);
  assert.throws(exec,/缺少可重放/);
}
console.log('PASS imported benchmark replay baseline, improvement, duplicates, missing oracle');
