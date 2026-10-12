'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function buildGoalPlan('),b=html.indexOf('\nfunction pct(',a);
assert(a>=0&&b>a,'goal planner missing');
const needs=[
 {entity:'light',property:'brightness',value:30,area:'客厅'},
 {entity:'light',property:'colorTemperature',value:3000,area:'客厅'}
];
function verify(secondAccepted){
 let seq=0;
 const ctx={
  goalNeeds:()=>needs,canonicalArea:()=> '客厅',canonicalEntityName:()=> '客厅灯',
  newNode:(intent,entity,slots)=>({intent,target:{entity},slots}),
  retrieveCapabilities:(goal,raw,need)=>{
    const index=seq++;const id='cap'+index,cap={capability_id:id,model:'LIGHT',module:'MAIN',code:need.property,product:'灯'};
    const accepted=index===1&&!secondAccepted?[]:[{capability:cap,score:23,entity:'light'}];
    return {accepted,top:[{capability_id:id,score:23,constraint_ok:!!accepted.length}],ranked:[{capability:cap}]};
  }
 };
 vm.createContext(ctx);
 const plan=vm.runInContext(html.slice(a,b)+"\nbuildGoalPlan({goal:'movie_comfort'},'客厅','准备看电影')",ctx);
 if(secondAccepted){assert.equal(plan.gate,'EXECUTE');assert.equal(plan.nodes.length,2);assert.equal(plan.selected.length,2)}
 else{assert.equal(plan.gate,'UNSUPPORTED');assert.equal(plan.nodes.length,0);assert.equal(plan.selected.length,0);assert(plan.candidates.every(c=>c.selected===false))}
}
verify(false);verify(true);
console.log('PASS compound goal atomicity and valid dual-capability plan');
