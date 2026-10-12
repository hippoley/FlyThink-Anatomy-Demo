'use strict';
const assert=require('node:assert/strict');
const {inferWithBackend}=require('../scripts/inference_backend_router.cjs');
(async()=>{
 const backends={
  fly_sparse_v1:async()=>({candidates:[{label:'fan_on',score:.91},{label:'fan_on',score:.4},{label:'window_open',score:.65},{label:'rogue',score:1},{label:'bad',score:NaN}],physical_device_id:'fake'}),
  tinybert_onnx:async()=>({candidates:[{label:'fan_on',score:.8},{label:'window_open',score:.8}]}),
  local_small_llm:async()=>({candidates:[{label:'window_open',score:.98}]})
 };
 const args={backends,text:'客厅有点闷',context_revision:'rev-12',allowedLabels:['fan_on','window_open'],maxCandidates:2};
 const a=await inferWithBackend({...args,backend:'fly_sparse_v1'});
 assert.equal(a.proposal.selected_label,'fan_on');
 assert.equal(a.proposal.physical_device_id,null);
 assert.equal(a.proposal.context_revision,'rev-12');
 assert.deepEqual(a.diagnostics.counts,{returned:5,valid:2,invalid:1,disallowed:1,duplicate:1,retained:2});
 assert.equal(a.diagnostics.flows.filter(x=>x.source==='Model output').reduce((n,x)=>n+x.value,0),5);
 assert.equal(a.diagnostics.kind,'inference_candidate_flow_not_device_grounding');
 const b=await inferWithBackend({...args,backend:'tinybert_onnx'});
 assert.equal(b.proposal.decision,'CLARIFY');
 const c=await inferWithBackend({...args,backend:'local_small_llm'});
 assert.equal(c.proposal.selected_label,'window_open');
 await assert.rejects(()=>inferWithBackend({...args,backend:'nonexistent'}),/backend_not_registered/);
 await assert.rejects(()=>inferWithBackend({...args,backend:'local_small_llm',text:' '}),/input_text_required/);
 console.log('PASS registered backend switching, ambiguity, authority stripping, trace conservation and error gates');
})().catch(e=>{console.error(e);process.exitCode=1});
