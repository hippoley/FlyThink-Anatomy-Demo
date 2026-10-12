'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function bindingForCapability('),b=html.indexOf('\nfunction routeNode(',a);
assert(a>=0&&b>a,'binding function unavailable');
const source=html.slice(a,b);
function check(overrides){
 const capability={capability_id:'cap1',model:'LIGHT',module:'MAIN',code:'brightness',kind:'p',ops:['write'],product:'灯'};
 const state={lastArea:'客厅',thingValues:{}};
 const ctx={state,CAPINDEX:{truth:'fixture'},THING_MODEL_SOURCE_SHA256:'fixture',
 capabilityById:()=>capability,capabilityValueCheck:()=>({ok:true}),
 canonicalEntityName:()=> '客厅灯'};
 vm.createContext(ctx);
 const node={intent:'SetValue',target:{entity:'light'},slots:{area:'客厅',value:30,capability_id:'cap1',model_code:'LIGHT',module_code:'MAIN',schema_property:'brightness',...overrides}};
 const output=vm.runInContext(source+'\nbindingForCapability(node)',Object.assign(ctx,{node}));
 return {output,state};
}
for(const slots of [{model_code:'OTHER'},{module_code:'OTHER'},{schema_property:'power'}]){
 const {output,state}=check(slots);
 assert.equal(output.grounding_status,'BLOCKED');
 assert.equal(output.worldDelta,null);
 assert.deepEqual(Object.keys(state.thingValues),[]);
}
const valid=check({});
assert.equal(valid.output.grounding_status,'ALLOW');
assert.equal(valid.output.worldDelta.after,30);
assert.equal(Object.keys(valid.state.thingValues).length,1);
console.log('PASS downstream exact capability identity enforced before write');
