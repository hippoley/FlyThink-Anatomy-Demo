'use strict';
const {normalizeProposal}=require('./inference_proposal_adapter.cjs');
/**
 * Runtime-neutral inference orchestrator. Models only return hypotheses.
 * All registry and physical authority remains with NLUSLOT / execution gate.
 */
async function inferWithBackend({backend,backends,text,context_revision,allowedLabels,maxCandidates=8}){
 if(typeof text!=='string'||!text.trim())throw Error('input_text_required');
 if(!backends||typeof backends[backend]!=='function')throw Error('backend_not_registered');
 if(!Array.isArray(allowedLabels)||!allowedLabels.length)throw Error('allowed_labels_required');
 const raw=await backends[backend]({text,context_revision,allowedLabels:[...allowedLabels]});
 if(!raw||!Array.isArray(raw.candidates))throw Error('backend_invalid_output');
 const result=normalizeProposal({...raw,backend,context_revision},{allowedLabels,maxCandidates});
 const counts={returned:raw.candidates.length,valid:0,invalid:0,disallowed:0,duplicate:0,retained:result.candidates.length};
 const known=new Set(),allowed=new Set(allowedLabels);
 for(const candidate of raw.candidates){
  if(!candidate||typeof candidate.label!=='string'||typeof candidate.score!=='number'||!Number.isFinite(candidate.score)||candidate.score<0||candidate.score>1){counts.invalid++;continue}
  if(!allowed.has(candidate.label)){counts.disallowed++;continue}
  if(known.has(candidate.label)){counts.duplicate++;continue}
  known.add(candidate.label);counts.valid++;
 }
 const flows=[
  {source:'Model output',target:'Valid scored candidate',value:counts.valid},
  {source:'Model output',target:'Invalid score / schema',value:counts.invalid},
  {source:'Model output',target:'Disallowed label',value:counts.disallowed},
  {source:'Model output',target:'Duplicate label',value:counts.duplicate},
  {source:'Valid scored candidate',target:'Retained Top-K + ties',value:counts.retained},
  {source:'Valid scored candidate',target:'Pruned by Top-K',value:counts.valid-counts.retained},
  {source:'Retained Top-K + ties',target:result.decision==='CLARIFY'?'Clarification required':'Untrusted proposal',value:counts.retained}
 ].filter(x=>x.value>0);
 return {proposal:result,diagnostics:{kind:'inference_candidate_flow_not_device_grounding',backend,counts,flows}};
}
module.exports={inferWithBackend};
