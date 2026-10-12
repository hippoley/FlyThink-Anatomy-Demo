'use strict';
/**
 * FlyThink inference adapter boundary (research only, non-authoritative).
 * Backends may rank semantic hypotheses, NEVER choose a physical device ID,
 * authorize a GraphDelta, or assert actual completion.
 * Compatible with a fly-inspired readout, lexical baseline, BERT or small LLM.
 */
const CONTRACT='flythink.inference-proposal.v1';
function normalizeProposal(input, {allowedLabels=[],maxCandidates=8,tieEpsilon=1e-6}={}){
 if(!input||typeof input!=='object')throw Error('proposal_required');
 const backend=String(input.backend||'').trim();
 if(!/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(backend))throw Error('invalid_backend');
 if(!Array.isArray(input.candidates))throw Error('candidates_required');
 const allowed=new Set(allowedLabels);
 const candidates=[];
 for(const x of input.candidates){
  if(!x||typeof x.label!=='string'||!allowed.has(x.label))continue;
  if(typeof x.score!=='number'||!Number.isFinite(x.score)||x.score<0||x.score>1)continue;
  candidates.push({label:x.label,score:x.score});
 }
 candidates.sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label));
 const unique=[];
 for(const x of candidates)if(!unique.some(y=>y.label===x.label))unique.push(x);
 const threshold=unique.length>maxCandidates?unique[maxCandidates-1]?.score:null;
 const selected=unique.filter((x,i)=>i<maxCandidates||threshold!==null&&Math.abs(x.score-threshold)<=tieEpsilon);
 const tiedTop=selected.length>1&&Math.abs(selected[0].score-selected[1].score)<=tieEpsilon;
 const abstained=!!input.abstain||selected.length===0||tiedTop;
 const sanitized={contract:CONTRACT,backend,source_role:'untrusted_semantic_proposal',
  context_revision:typeof input.context_revision==='string'?input.context_revision:null,
  candidates:selected,decision:abstained?'CLARIFY':'PROPOSE',
  selected_label:abstained?null:selected[0].label,
  physical_device_id:null,authorization:null,execution_claim:null,
  reason:!selected.length?'NO_ALLOWED_CANDIDATES':tiedTop?'TOP_TIE':input.abstain?'BACKEND_ABSTAIN':'RANKED_PROPOSAL'};
 return sanitized;
}
module.exports={normalizeProposal,CONTRACT};
