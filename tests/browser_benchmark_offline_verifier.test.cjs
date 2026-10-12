'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {verify}=require('../scripts/verify_browser_benchmark_evidence.cjs');
function receipt(){
 return {schema_version:'flythink.benchmark.evidence.v1',evidence_type:'local_browser_regression_not_real_hardware',source:'generated_contract_derived_not_independent_gold',review_status:'unreviewed_not_training_gold',
 totals:{sequences:1,turns:1,passed_turns:1,passed_sequences:1},
 cases:[{id:'case-01',passed:true,passed_turns:1,turns:[{input:'把客厅灯关掉',expected:{op:'CREATE_TASK'},actual_commit_status:null,actual_failure_code:null,actual_world_deltas:[{key:'light',after:false}],failure_codes:[],pass:true}]}]};
}
test('valid structural evidence passes',()=>assert.deepEqual(verify(receipt()),[]));
test('cannot claim a rejected write succeeded',()=>{
 const r=receipt(),t=r.cases[0].turns[0];t.actual_commit_status='REJECTED_ATOMIC_SIMULATION';
 assert(verify(r).some(e=>e.reason==='rejection_not_recorded_as_failure'));
 assert(verify(r).some(e=>e.reason==='rejected_with_world_deltas'));
 assert(verify(r).some(e=>e.reason==='turn_pass_inconsistent'));
});
test('cannot falsify aggregate pass count',()=>{
 const r=receipt();r.totals.passed_turns=99;
 assert(verify(r).some(e=>e.reason==='total_mismatch'));
});
test('proper rejected case is structurally valid',()=>{
 const r=receipt(),t=r.cases[0].turns[0];t.actual_commit_status='REJECTED_ATOMIC_SIMULATION';
 t.actual_failure_code='EXECUTION_ADAPTER_EXCEPTION';t.actual_world_deltas=[];
 t.failure_codes=['EXECUTION_ADAPTER_EXCEPTION'];t.pass=false;
 r.cases[0].passed=false;r.cases[0].passed_turns=0;
 r.totals.passed_turns=0;r.totals.passed_sequences=0;
 assert.deepEqual(verify(r),[]);
});

test('refuse evidence promoted to independent Gold',()=>{
 const r=receipt();r.source='independent_human_gold_verified';r.review_status='verified';
 const reasons=verify(r).map(e=>e.reason);
 assert(reasons.includes('untrusted_or_missing_provenance'));
 assert(reasons.includes('unreviewed_evidence_claim_promoted'));
});
test('refuse clarification route counted as passing',()=>{
 const r=receipt();r.cases[0].turns[0].actual_route='CLARIFY';
 const reasons=verify(r).map(e=>e.reason);
 assert(reasons.includes('blocked_route_marked_success'));
 assert(reasons.includes('turn_pass_inconsistent'));
});
