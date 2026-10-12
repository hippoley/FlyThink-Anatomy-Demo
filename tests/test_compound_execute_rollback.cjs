'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const extract=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert(i>=0&&j>i);return html.slice(i,j)};
const source=extract('function bindingForCapability(','\nfunction routeNode(')+'\n'+extract('function executeCurrent(','\nconst STARTER_SCENES=');
function run(blockSecond){
  const state={thingValues:{'existing::keep':123},lastArea:'客厅',lastAction:'old'};
  const caps=[{capability_id:'one',model:'LIGHT',module:'MAIN',code:'brightness',kind:'p',ops:['write'],product:'灯'},
    {capability_id:'two',model:'LIGHT',module:'MAIN',code:'colorTemperature',kind:'p',ops:['write'],product:'灯'}];
  const nodes=caps.map((c,i)=>({intent:'SetValue',target:{entity:'light'},slots:{capability_id:c.capability_id,area:'客厅',
    model_code:i===1&&blockSecond?'OTHER':c.model,module_code:c.module,schema_property:c.code,value:i===0?30:3000}}));
  const ctx={state,CAPINDEX:{truth:'fixture'},THING_MODEL_SOURCE_SHA256:'fixture',clone:x=>JSON.parse(JSON.stringify(x)),
    capabilityById:id=>caps.find(c=>c.capability_id===id),capabilityValueCheck:()=>({ok:true}),
    canonicalEntityName:()=> '客厅灯',nodesForCurrentTurn:()=>nodes,
    routeNode:n=>({route:'THING_MODEL_EXECUTE',action:'capability:'+n.slots.capability_id})};
  vm.createContext(ctx);
  const result=vm.runInContext(source+'\nexecuteCurrent({}, {op:"CREATE_TASK"})',ctx);
  return {state,result};
}
const rejected=run(true);
assert.equal(rejected.result.commit_status,'REJECTED_ATOMIC_SIMULATION');
assert.equal(rejected.result.actions.length,0);
assert.equal(rejected.result.worldDeltas.length,0);
assert.equal(rejected.result.outputs[0].action,null);
assert.equal(rejected.result.outputs[1].grounding_status,'BLOCKED');
assert.deepEqual(JSON.parse(JSON.stringify(rejected.state.thingValues)),{'existing::keep':123});
assert.equal(rejected.state.lastAction,'old');
const committed=run(false);
assert.equal(committed.result.worldDeltas.length,2);
assert.equal(committed.result.actions.length,2);
assert.equal(Object.keys(committed.state.thingValues).length,3);
console.log('PASS compound executor rollback: zero partial writes/actions on blocked second node; both accepted when valid');
