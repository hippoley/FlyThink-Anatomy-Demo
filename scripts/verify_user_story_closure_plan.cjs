'use strict';
const REQUIRED=['code','regression','cross_module_integration','horizontal_audit','physical_or_external','ci'];
function verifyClosurePlan(doc, verifiedReceipts=new Map()){
 // Receipt verification must arrive from the independent runner, never from
 // manifest-authored PASS/reviewed fields. Fail closed without that runner.
 const errors=[];
 if(!doc||!Array.isArray(doc.stories))return ['invalid_stories'];
 for(const story of doc.stories){
  const prefix=story.id||'unknown';
  if(!story.acceptance){errors.push(prefix+':missing_acceptance');continue}
  for(const gate of REQUIRED){
   const g=story.acceptance[gate];
   if(!g||g.required!==true||!Array.isArray(g.evidence)){errors.push(prefix+':invalid_gate:'+gate);continue}
   if(story.status==='CLOSED'){
    if(!g.evidence.length)errors.push(prefix+':missing_evidence:'+gate);
    for(const e of g.evidence){
     const verified=verifiedReceipts instanceof Map ? verifiedReceipts.get(prefix+':'+gate+':'+e?.ref) : null;
     if(!verified||verified.verified!==true||verified.story_id!==prefix||verified.gate!==gate||verified.ref!==e?.ref||!(/^[a-f0-9]{40}$/.test(e?.revision_sha||''))||verified.revision_sha!==e.revision_sha||verified.independent_source!==true){
       errors.push(prefix+':unverified_external_receipt:'+gate);
     }
     if(!e||typeof e.ref!=='string'||!e.ref.trim()||
        typeof e.scope!=='string'||!e.scope.trim()||
        e.result!=='PASS'||e.reviewed!==true){
       errors.push(prefix+':invalid_evidence:'+gate);
     }
    }
   }
  }
  if(!['OPEN','CLOSED'].includes(story.status))errors.push(prefix+':invalid_status');
 }
 return errors;
}
module.exports={verifyClosurePlan,REQUIRED};
