'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const extract=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert(i>=0&&j>i);return html.slice(i,j)};
const execute=extract('function executeCurrent(','\nconst STARTER_SCENES=');
const friendly=extract('function friendlyTurn(','\nfunction turnJourneyData(');
const state={thingValues:{'preserved':42},lastAction:'old'};
const nodes=[{intent:'SetValue',target:{entity:'light'},slots:{area:'客厅'}},{intent:'SetValue',target:{entity:'light'},slots:{area:'主卧'}}];
const env={state,clone:x=>JSON.parse(JSON.stringify(x)),nodesForCurrentTurn:()=>nodes,
 routeNode:n=>({route:'THING_MODEL_EXECUTE',action:'write:'+n.slots.area}),
 bindingForAction:(action,n)=>{
  if(n.slots.area==='客厅'){state.thingValues['客厅灯']=30;return {route:'THING_MODEL_EXECUTE',action,worldDelta:{key:'客厅灯',before:null,after:30}}}
  return {route:'THING_MODEL_EXECUTE',action:null,grounding_status:'NEEDS_GROUNDING',worldDelta:null}
 }};
vm.createContext(env);
const out=vm.runInContext(execute+'\nexecuteCurrent({}, {op:"CREATE_TASK"})',env);
assert.equal(out.commit_status,'REJECTED_ATOMIC_SIMULATION');
assert.deepEqual(JSON.parse(JSON.stringify(state.thingValues)),{'preserved':42});
assert.deepEqual(Array.from(out.actions),[]);
assert.deepEqual(Array.from(out.worldDeltas),[]);
assert.equal(state.lastAction,'old');
const response=vm.runInContext(friendly+'\nfriendlyTurn(out, {op:"CREATE_TASK"})',Object.assign(env,{out}));
assert.equal(response.blocked,true);
assert.match(response.detail,/整体拒绝/);
console.log('PASS ungrounded node rolls back prior simulated write and user sees blocked result');
