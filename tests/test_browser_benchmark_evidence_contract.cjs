'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function benchmarkEvidenceDocument(){');
const end=html.indexOf('\nfunction persistBenchmarkEvidence()',start);
assert(start>=0&&end>start,'evidence builder missing');
const fn=html.slice(start,end);
const expected={op:'PATCH_SLOT',area:'主卧',scenario:false};
const scope={
 benchmarkResults:[{id:'case-01',family:'crossroom',pass:false,passedTurns:0,
 turnResults:[{turn:{type:'crossroom',text:'主卧那个也做一样的',expected},
 result:{delta:{op:'CREATE_TASK'},exec:{route:'BLOCKED',nodes:[]}},
 pre:{focus:'客厅'},post:{focus:'客厅'},failures:['graph_delta'],pass:false}]}],
 benchmarkScenarios:[{id:'case-01'}],
 $:sel=>({value:sel==='#benchSeed'?'400':'mixed'}),
};
vm.createContext(scope);
const doc=vm.runInContext(fn+'\nbenchmarkEvidenceDocument()',scope);
assert.equal(doc.totals.turns,1);
assert.equal(doc.cases[0].turns[0].expected.op,'PATCH_SLOT','expected oracle must not silently disappear');
assert.equal(doc.cases[0].turns[0].failure_codes[0],'graph_delta');
assert.equal(doc.generator.seed,400);
assert.equal(doc.source,'generated_contract_derived_not_independent_gold');
assert.equal(doc.review_status,'unreviewed_not_training_gold');
console.log('PASS benchmark evidence oracle and provenance contract');
