'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function executeCurrent('),b=html.indexOf('\nconst STARTER_SCENES=',a);
assert(a>=0&&b>a);
const state={thingValues:{keep:42},lastAction:'previous'};
const nodes=[{slots:{area:'客厅'}},{slots:{area:'主卧'}}];
let calls=0;
const env={state,clone:x=>JSON.parse(JSON.stringify(x)),nodesForCurrentTurn:()=>nodes,
 routeNode:()=>({route:'THING_MODEL_EXECUTE',action:'write'}),
 bindingForAction:()=>{if(++calls===1){state.thingValues.partial=30;return {route:'THING_MODEL_EXECUTE',action:'write',worldDelta:{key:'partial',after:30}}}throw Error('adapter exploded')},
};
vm.createContext(env);
const result=vm.runInContext(html.slice(a,b)+'\nexecuteCurrent({}, {op:"CREATE_TASK"})',env);
assert.equal(result.commit_status,'REJECTED_ATOMIC_SIMULATION');
assert.equal(result.failure_code,'EXECUTION_ADAPTER_EXCEPTION');
assert.equal(result.actions.length,0);
assert.equal(result.worldDeltas.length,0);
assert.deepEqual(JSON.parse(JSON.stringify(state.thingValues)),{keep:42});
assert.equal(state.lastAction,'previous');
console.log('PASS exception in second adapter restores state and suppresses all actions');
