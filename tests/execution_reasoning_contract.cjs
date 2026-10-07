"use strict";

const assert=require("assert");
const fs=require("fs");
const path=require("path");
const {
  validateExecutionRequest,
  validateExecutionProposal
}=require("../scripts/execution_reasoning_contract.cjs");

function clone(v){return JSON.parse(JSON.stringify(v))}
function setPath(root,pathText,value){
  const parts=String(pathText).split(".");
  let cur=root;
  for(let i=0;i<parts.length-1;i++){
    const part=parts[i];
    const index=/^\d+$/.test(part)?Number(part):part;
    cur=cur[index];
  }
  const last=parts[parts.length-1];
  cur[/^\d+$/.test(last)?Number(last):last]=clone(value);
}
function buildCase(fixture,row){
  const request=clone(fixture.base.request);
  const proposal=clone(fixture.base.proposal);
  for(const mutation of row.mutations||[]){
    setPath(row.kind==="request"?request:proposal,mutation.path,mutation.value);
  }
  if(row.append_candidate_from!=null){
    request.candidate_actions.push(
      clone(request.candidate_actions[row.append_candidate_from])
    );
  }
  if(row.extra_candidate){
    request.candidate_actions.push(clone(row.extra_candidate));
    if(row.append_extra_proposed){
      proposal.proposed_actions.push(clone(row.extra_candidate));
    }
  }
  if(row.append_proposed_from!=null){
    proposal.proposed_actions.push(
      clone(proposal.proposed_actions[row.append_proposed_from])
    );
  }
  return {request,proposal};
}

const fixture=JSON.parse(fs.readFileSync(
  path.join(__dirname,"..","benchmarks","execution_reasoning_contract_cases.json"),
  "utf8"
));
assert.equal(fixture.schema_version,"flythink-execution-contract-cases-v1");

for(const row of fixture.cases){
  const {request,proposal}=buildCase(fixture,row);
  let error=null;
  try{
    if(row.kind==="request"){
      validateExecutionRequest(request);
    }else{
      validateExecutionProposal(proposal,request);
    }
  }catch(e){error=String(e&&e.message||e)}

  if(row.expect==="PASS"){
    assert.equal(error,null,row.id+":"+String(error));
  }else{
    assert.ok(error,row.id+": expected error");
    assert.ok(
      error.includes(row.expect_error),
      row.id+": expected "+row.expect_error+" got "+error
    );
  }
}

console.log(JSON.stringify({
  ok:true,
  cases:fixture.cases.length,
  contract:"Node production validator matches shared execution reasoning fixture"
}));
