'use strict';
const assert=require('node:assert/strict');
const {normalizeProposal}=require('../scripts/inference_proposal_adapter.cjs');
const cfg={allowedLabels:['open_window','close_window','fan_on','clarify'],maxCandidates:2};
const backends=['fly_sparse_v1','tinybert_onnx','small_llm_local'];
for(const backend of backends){
 const result=normalizeProposal({backend,candidates:[{label:'fan_on',score:.91},{label:'open_window',score:.7}],physical_device_id:'attacker-id',authorization:'yes',execution_claim:'VERIFIED_COMPLETE'},cfg);
 assert.equal(result.decision,'PROPOSE');
 assert.equal(result.selected_label,'fan_on');
 assert.equal(result.physical_device_id,null);
 assert.equal(result.authorization,null);
 assert.equal(result.execution_claim,null);
 assert.equal(result.source_role,'untrusted_semantic_proposal');
}
const ambiguous=normalizeProposal({backend:'fly_sparse_v1',candidates:[{label:'fan_on',score:.8},{label:'open_window',score:.8}]},cfg);
assert.equal(ambiguous.decision,'CLARIFY');assert.equal(ambiguous.selected_label,null);
const malicious=normalizeProposal({backend:'small_llm_local',candidates:[{label:'unregistered_device',score:1},{label:'fan_on',score:.7}]},cfg);
assert.equal(malicious.selected_label,'fan_on');
const tie=normalizeProposal({backend:'tinybert_onnx',candidates:[{label:'fan_on',score:.9},{label:'open_window',score:.8},{label:'close_window',score:.8}]},cfg);
assert.equal(tie.candidates.length,3,'Top-K ties must not silently disappear');
const none=normalizeProposal({backend:'fly_sparse_v1',candidates:[]},cfg);
assert.equal(none.decision,'CLARIFY');
assert.throws(()=>normalizeProposal({backend:'bad',candidates:null},cfg),/candidates_required/);
console.log('PASS three backend classes, authority stripping, tie, abstain, and allowed labels');
