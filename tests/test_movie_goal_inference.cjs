'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function composeGoalScenario(text){');
const b=html.indexOf('\nfunction capabilityText(',a);
assert(a>=0&&b>a,'goal composer missing');
const ctx={
  state:{lastArea:'客厅'},areasInText:()=>['客厅'],
  canonicalArea:()=> '客厅',
  scenarioClauses:()=>[{text:'准备看电影了',area:'客厅'},{text:'客厅有点刺眼',area:'客厅'}],
  HOME_INVENTORY:{'客厅':{light:'MODEL'}},
  HOME_INVENTORY_MODULES:{'客厅':{light:'MODULE'}},HOME_AREAS:['客厅']
};
vm.createContext(ctx);
const scene=vm.runInContext(html.slice(a,b)+"\ncomposeGoalScenario('准备看电影了，客厅有点刺眼')",ctx);
assert.equal(scene.goal,'movie_comfort');
assert.deepEqual(Array.from(scene.needs.map(x=>x.property)),['brightness','colorTemperature']);
assert.deepEqual(Array.from(scene.needs.map(x=>x.area)),['客厅','客厅']);
console.log('PASS movie scene retains explicit goal and two deduplicated needs');
