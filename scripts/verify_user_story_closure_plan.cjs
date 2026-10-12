'use strict';
const REQUIRED=['code','regression','cross_module_integration','horizontal_audit','physical_or_external','ci'];
function verifyClosurePlan(doc){
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
