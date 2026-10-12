'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function buildGoalPlan('),b=html.indexOf('\nfunction pct(',a);
assert(a>=0&&b>a,'goal plan builder missing');
const ctx={
 goalNeeds:()=>[],retrieveCapabilities:()=>{throw Error('should not retrieve')},
 newNode:()=>{throw Error('should not dispatch')},canonicalArea:()=>null,
 canonicalEntityName:()=>null
};
vm.createContext(ctx);
const plan=vm.runInContext(html.slice(a,b)+"\nbuildGoalPlan({goal:'unknown'},'客厅','随便做点什么')",ctx);
assert.equal(plan.gate,'UNSUPPORTED');
assert.equal(plan.nodes.length,0);
assert.equal(plan.selected.length,0);
console.log('PASS empty goal plan is UNSUPPORTED, never EXECUTE');
