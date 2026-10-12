'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const p=path.join(__dirname,'..','contracts','open-user-story-closure-plan.v1.json');
const d=JSON.parse(fs.readFileSync(p,'utf8'));
const {verifyClosurePlan,REQUIRED}=require('../scripts/verify_user_story_closure_plan.cjs');
const expected=['02','03','04','08','10','11','12','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34'].map(x=>'US-'+x);
assert.equal(d.schema_version,'flythink.user-story-closure-plan.v1');
assert.equal(d.all_selected,true);
assert.deepEqual(d.stories.map(x=>x.id).sort(),expected.sort());
assert.equal(new Set(d.stories.map(x=>x.id)).size,25);
assert(d.stories.every(x=>x.selected===true),'all remaining stories must stay selected');
assert(d.stories.every(x=>[1,2,3].includes(x.batch)),'every story belongs to one batch');
assert(d.stories.every(x=>x.status==='OPEN'||x.status==='CLOSED'),'invalid closure status');
assert(d.stories.every(x=>x.status!=='CLOSED'||(Array.isArray(x.closure_evidence)&&x.closure_evidence.length>0)),'cannot close story without evidence');
assert(d.batches.every(b=>b.first.every(id=>d.stories.some(x=>x.id===id&&x.batch===b.id))),'batch and story assignments inconsistent');
const assigned=d.batches.flatMap(b=>b.first);
assert.equal(new Set(assigned).size,25,'batch lists must partition all 25 stories exactly once');
console.log('PASS 25/25 selected, unique, grouped, and evidence-gated');

assert.deepEqual(verifyClosurePlan(d),[],'current OPEN manifest must have complete gate definitions');
assert(d.stories.every(s=>REQUIRED.every(k=>s.acceptance[k].required)),'all gates required');
for(const gate of REQUIRED){
 const specimen=JSON.parse(JSON.stringify(d));
 const story=specimen.stories[0];
 story.status='CLOSED';
 for(const k of REQUIRED)story.acceptance[k].evidence=[{ref:'tests/verified-'+k+'.cjs',scope:'fixture',result:'PASS',reviewed:true}];
 story.acceptance[gate].evidence=[];
 assert(verifyClosurePlan(specimen).some(e=>e.includes('missing_evidence:'+gate)),'missing '+gate+' must reject closure');
}
{
 const forged=JSON.parse(JSON.stringify(d)),x=forged.stories[0];x.status='CLOSED';
 for(const gate of REQUIRED)x.acceptance[gate].evidence=[{ref:'self-reported-success',scope:'browser',result:'PASS',reviewed:false}];
 assert(verifyClosurePlan(forged).some(e=>e.includes('invalid_evidence')),'unreviewed artifacts cannot close a story');
}
console.log('PASS mandatory six-gate closure checks and negative cases');

{
 const forged=JSON.parse(JSON.stringify(d)),story=forged.stories[0];story.status='CLOSED';
 for(const gate of REQUIRED)story.acceptance[gate].evidence=[{ref:'receipt-'+gate,scope:'reproducible',result:'PASS',reviewed:true}];
 assert(REQUIRED.every(g=>verifyClosurePlan(forged).includes(story.id+':unverified_external_receipt:'+g)),
  'manifest PASS and reviewed flags must not verify their own receipts');
 const independentlyChecked=new Map(REQUIRED.map(g=>{
  const ref='receipt-'+g;
  return [story.id+':'+g+':'+ref,{verified:true,story_id:story.id,gate:g,ref}];
 }));
 assert.deepEqual(verifyClosurePlan(forged,independentlyChecked),[],
  'trusted verification results may satisfy evidence gates');
 independentlyChecked.set(story.id+':ci:receipt-ci',{verified:true,story_id:'OTHER',gate:'ci',ref:'receipt-ci'});
 assert(verifyClosurePlan(forged,independentlyChecked).includes(story.id+':unverified_external_receipt:ci'),
  'wrong-story receipt must be rejected');
}
console.log('PASS rejects self-attested receipts, accepts independently verified scoped receipts');
