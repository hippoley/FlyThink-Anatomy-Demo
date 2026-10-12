'use strict';
// Standalone Node regression for the browser benchmark's human-session boundary.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function runBenchmark(){');
const b=html.indexOf('\nconst BENCHMARK_EVIDENCE_KEY',a);
assert(a>=0&&b>a,'benchmark function missing');
const implementation=html.slice(a,b);
for(const injectFailure of [false,true]){
  let resetCount=0,persistCount=0;
  const scope={
    state:{turn:13,focus:'客厅',sessionEvents:[{text:'private human turn'}]},
    neuralState:[1],semanticScores:[2],projectedRoots:[3],currentCorpusCase:'human',
    benchmarkScenarios:[{id:'case-01',turns:[{text:'benchmark-only'}]}],
    benchmarkResults:[],
    clone:x=>JSON.parse(JSON.stringify(x)),
    resetRuntimeState(){this.state.turn=0;this.state.focus=null;this.state.sessionEvents=[];this.neuralState=[99]},
    composerSnapshot(){return {turn:this.state.turn}},
    submit(text,opts){
      assert.equal(text,'benchmark-only');
      assert.equal(opts.silent,true);
      assert.equal(opts.transient,true);
      this.state.turn++;
      if(injectFailure)throw new Error('injected benchmark crash');
      return {delta:{op:'NO_CHANGE'},exec:{nodes:[]}};
    },
    diagnoseBenchmarkTurn:()=>[],
    persistBenchmarkEvidence(){persistCount++},
    renderBenchmark(){},
    reset(){resetCount++},
    generateBenchmark(){throw new Error('unexpected generation')}
  };
  const sandbox=vm.createContext(scope);
  if(injectFailure)assert.throws(()=>vm.runInContext(implementation+'\nrunBenchmark();',sandbox),/injected benchmark crash/);
  else vm.runInContext(implementation+'\nrunBenchmark();',sandbox);
  assert.equal(scope.state.turn,13);
  assert.equal(scope.state.focus,'客厅');
  assert.equal(scope.state.sessionEvents[0].text,'private human turn');
  assert.equal(resetCount,0,'benchmark must never reset human session');
  assert.equal(persistCount,injectFailure?0:1);
}
console.log('PASS browser benchmark session isolation (normal + exception)');

