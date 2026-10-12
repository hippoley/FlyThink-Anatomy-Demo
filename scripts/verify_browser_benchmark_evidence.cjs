#!/usr/bin/env node
'use strict';
// Independent structural/conformance checks for locally exported browser regressions.
// Does not certify semantic ground truth, hardware execution, or evidence provenance.
const fs=require('node:fs');
function verify(doc){
 const errors=[];
 const fail=(location,reason)=>errors.push({location,reason});
 if(!doc||typeof doc!=='object'||Array.isArray(doc))return [{location:'$',reason:'invalid_document'}];
 if(doc.schema_version!=='flythink.benchmark.evidence.v1')fail('$','unsupported_schema');
 if(doc.evidence_type!=='local_browser_regression_not_real_hardware')fail('
 if(!Array.isArray(doc.cases)||!doc.cases.length||doc.cases.length>48)return [...errors,{location:'$.cases',reason:'invalid_case_count'}];
 const ids=new Set();let turns=0,passedTurns=0,passedCases=0;
 for(let i=0;i<doc.cases.length;i++){
  const sc=doc.cases[i],where='$.cases['+i+']';
  if(!sc||typeof sc!=='object'||!Array.isArray(sc.turns)||!sc.turns.length||sc.turns.length>30){fail(where,'invalid_case');continue}
  if(typeof sc.id!=='string'||!sc.id||ids.has(sc.id))fail(where,'duplicate_or_invalid_id');
  ids.add(sc.id);
  let casePass=true,casePassed=0;
  for(let j=0;j<sc.turns.length;j++){
   const t=sc.turns[j],at=where+'.turns['+j+']';turns++;
   if(!t||typeof t!=='object'){fail(at,'invalid_turn');casePass=false;continue}
   if(typeof t.input!=='string'||!t.input.trim()||t.input.length>1000)fail(at,'invalid_input');
   if(!t.expected||typeof t.expected!=='object'||Array.isArray(t.expected))fail(at,'missing_expected_contract');
   if(!Array.isArray(t.failure_codes)||t.failure_codes.some(x=>typeof x!=='string')){fail(at,'invalid_failure_codes');casePass=false;continue}
   const rejected=t.actual_commit_status==='REJECTED_ATOMIC_SIMULATION';
   if(t.actual_commit_status!==null&&t.actual_commit_status!==undefined&&!rejected)fail(at,'unknown_commit_status');
   const nonExecutableRoute=typeof t.actual_route==='string'&&/(?:CLARIFY|LLM_ESCALATE|OOD)/.test(t.actual_route);
   if(nonExecutableRoute&&t.failure_codes.length===0)fail(at,'blocked_route_marked_success');
   const deltas=t.actual_world_deltas;
   if(!Array.isArray(deltas)){fail(at,'missing_world_deltas');casePass=false}
   if(rejected){
    if(t.failure_codes.length===0)fail(at,'rejection_not_recorded_as_failure');
    if(Array.isArray(deltas)&&deltas.length)fail(at,'rejected_with_world_deltas');
    if(t.actual_failure_code&&!t.failure_codes.includes(t.actual_failure_code))fail(at,'failure_code_not_propagated');
   }
   if(t.actual_failure_code&&t.actual_commit_status!=='REJECTED_ATOMIC_SIMULATION')fail(at,'failure_code_without_rejection');
   const expectedPass=t.failure_codes.length===0&&!rejected&&!nonExecutableRoute;
   if(t.pass!==expectedPass)fail(at,'turn_pass_inconsistent');
   if(expectedPass){passedTurns++;casePassed++}else casePass=false;
  }
  if(sc.passed!==casePass)fail(where,'case_pass_inconsistent');
  if(sc.passed_turns!==casePassed)fail(where,'case_passed_turns_inconsistent');
  if(casePass)passedCases++;
 }
 const totals=doc.totals||{};
 for(const [key,n] of Object.entries({sequences:doc.cases.length,turns,passed_turns:passedTurns,passed_sequences:passedCases})){
  if(totals[key]!==n)fail('$.totals.'+key,'total_mismatch');
 }
 return errors;
}
if(require.main===module){
 const file=process.argv[2];
 if(!file){console.error('Usage: node scripts/verify_browser_benchmark_evidence.cjs <export.json>');process.exitCode=2}
 else{
  try{
   const errors=verify(JSON.parse(fs.readFileSync(file,'utf8')));
   if(errors.length){console.error(JSON.stringify({verified:false,errors},null,2));process.exitCode=1}
   else console.log(JSON.stringify({verified:true,scope:'structural_conformance_only_not_semantic_gold_or_physical_proof'}));
  }catch(err){console.error('invalid evidence: '+err.message);process.exitCode=1}
 }
}
module.exports={verify};
,'unsupported_evidence_type');
 // A self-produced benchmark must not self-promote to independent Gold or
 // hardware attestation merely by rewriting provenance fields.
 const sources=['generated_contract_derived_not_independent_gold','imported_unreviewed_replay_not_independent_gold'];
 if(!sources.includes(doc.source))fail('$.source','untrusted_or_missing_provenance');
 if(doc.review_status!=='unreviewed_not_training_gold')fail('$.review_status','unreviewed_evidence_claim_promoted');
 if(!Array.isArray(doc.cases)||!doc.cases.length||doc.cases.length>48)return [...errors,{location:'$.cases',reason:'invalid_case_count'}];
 const ids=new Set();let turns=0,passedTurns=0,passedCases=0;
 for(let i=0;i<doc.cases.length;i++){
  const sc=doc.cases[i],where='$.cases['+i+']';
  if(!sc||typeof sc!=='object'||!Array.isArray(sc.turns)||!sc.turns.length||sc.turns.length>30){fail(where,'invalid_case');continue}
  if(typeof sc.id!=='string'||!sc.id||ids.has(sc.id))fail(where,'duplicate_or_invalid_id');
  ids.add(sc.id);
  let casePass=true,casePassed=0;
  for(let j=0;j<sc.turns.length;j++){
   const t=sc.turns[j],at=where+'.turns['+j+']';turns++;
   if(!t||typeof t!=='object'){fail(at,'invalid_turn');casePass=false;continue}
   if(typeof t.input!=='string'||!t.input.trim()||t.input.length>1000)fail(at,'invalid_input');
   if(!t.expected||typeof t.expected!=='object'||Array.isArray(t.expected))fail(at,'missing_expected_contract');
   if(!Array.isArray(t.failure_codes)||t.failure_codes.some(x=>typeof x!=='string')){fail(at,'invalid_failure_codes');casePass=false;continue}
   const rejected=t.actual_commit_status==='REJECTED_ATOMIC_SIMULATION';
   const deltas=t.actual_world_deltas;
   if(!Array.isArray(deltas)){fail(at,'missing_world_deltas');casePass=false}
   if(rejected){
    if(t.failure_codes.length===0)fail(at,'rejection_not_recorded_as_failure');
    if(Array.isArray(deltas)&&deltas.length)fail(at,'rejected_with_world_deltas');
    if(t.actual_failure_code&&!t.failure_codes.includes(t.actual_failure_code))fail(at,'failure_code_not_propagated');
   }
   if(t.actual_failure_code&&t.actual_commit_status!=='REJECTED_ATOMIC_SIMULATION')fail(at,'failure_code_without_rejection');
   const expectedPass=t.failure_codes.length===0&&!rejected;
   if(t.pass!==expectedPass)fail(at,'turn_pass_inconsistent');
   if(expectedPass){passedTurns++;casePassed++}else casePass=false;
  }
  if(sc.passed!==casePass)fail(where,'case_pass_inconsistent');
  if(sc.passed_turns!==casePassed)fail(where,'case_passed_turns_inconsistent');
  if(casePass)passedCases++;
 }
 const totals=doc.totals||{};
 for(const [key,n] of Object.entries({sequences:doc.cases.length,turns,passed_turns:passedTurns,passed_sequences:passedCases})){
  if(totals[key]!==n)fail('$.totals.'+key,'total_mismatch');
 }
 return errors;
}
if(require.main===module){
 const file=process.argv[2];
 if(!file){console.error('Usage: node scripts/verify_browser_benchmark_evidence.cjs <export.json>');process.exitCode=2}
 else{
  try{
   const errors=verify(JSON.parse(fs.readFileSync(file,'utf8')));
   if(errors.length){console.error(JSON.stringify({verified:false,errors},null,2));process.exitCode=1}
   else console.log(JSON.stringify({verified:true,scope:'structural_conformance_only_not_semantic_gold_or_physical_proof'}));
  }catch(err){console.error('invalid evidence: '+err.message);process.exitCode=1}
 }
}
module.exports={verify};
