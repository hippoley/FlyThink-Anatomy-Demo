'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function bindingForCapability('),b=html.indexOf('\nfunction routeNode(',a);
assert(a>=0&&b>a);
function run(entityName){
 const state={lastArea:'客厅',thingValues:{'客厅主灯::LIGHT → MAIN → brightness':12}};
 const cap={capability_id:'cap',model:'LIGHT',module:'MAIN',code:'brightness',kind:'p',ops:['write'],product:'灯'};
 const node={intent:'SetValue',target:{entity:'light'},slots:{area:'主卧',entity_name:entityName,capability_id:'cap',model_code:'LIGHT',module_code:'MAIN',schema_property:'brightness',value:30}};
 const env={state,CAPINDEX:{truth:'test'},THING_MODEL_SOURCE_SHA256:'test',
 HOME_INVENTORY:{'客厅':{light:'LIGHT'},'主卧':{light:'LIGHT'}},HOME_INVENTORY_MODULES:{},
 capabilityById:()=>cap,capabilityValueCheck:()=>({ok:true}),canonicalEntityName:(entity,area)=>area+'主灯'};
 vm.createContext(env);return {output:vm.runInContext(html.slice(a,b)+'\nbindingForCapability(node)',Object.assign(env,{node})),state};
}
const wrong=run('客厅主灯');
assert.equal(wrong.output.grounding_status,'BLOCKED');
assert.equal(wrong.output.grounding_reason,'room_entity_name_mismatch');
assert.deepEqual(JSON.parse(JSON.stringify(wrong.state.thingValues)),{'客厅主灯::LIGHT → MAIN → brightness':12});
const right=run('主卧主灯');
assert.equal(right.output.grounding_status,'ALLOW');
assert.equal(right.state.thingValues['主卧主灯::LIGHT → MAIN → brightness'],30);
assert.equal(right.state.thingValues['客厅主灯::LIGHT → MAIN → brightness'],12);
console.log('PASS stale room identity blocked; correct identity changes only destination room');
