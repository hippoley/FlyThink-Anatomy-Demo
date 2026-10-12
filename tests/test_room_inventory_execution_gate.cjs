'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function bindingForCapability('),b=html.indexOf('\nfunction routeNode(',a);
assert(a>=0&&b>a,'bindingForCapability missing');
function run({area='客厅',model='DQDZ-LC12',module='MAIN',entity='light'}={}){
 const state={lastArea:'客厅',thingValues:{}};
 const cap={capability_id:'cap1',model,module,code:'brightness',kind:'p',ops:['write'],product:'灯'};
 const ctx={state,CAPINDEX:{truth:'fixture'},THING_MODEL_SOURCE_SHA256:'fixture',
  HOME_INVENTORY:{'客厅':{light:'DQDZ-Y15R'},'主卧':{light:'DQDZ-LC12'}},
  HOME_INVENTORY_MODULES:{},capabilityById:()=>cap,capabilityValueCheck:()=>({ok:true}),
  canonicalEntityName:()=>area+'主灯'};
 const node={intent:'SetValue',target:{entity},slots:{capability_id:'cap1',area,model_code:model,module_code:module,schema_property:'brightness',value:30}};
 vm.createContext(ctx);
 const output=vm.runInContext(html.slice(a,b)+'\nbindingForCapability(node)',Object.assign(ctx,{node}));
 return {output,state};
}
for(const opts of [{area:'客厅',model:'DQDZ-LC12'},{area:'未知',model:'DQDZ-LC12'},{area:'主卧',model:'DQDZ-Y15R'}]){
 const {output,state}=run(opts);
 assert.equal(output.grounding_status,'BLOCKED');
 assert.equal(output.grounding_reason,'room_inventory_identity_mismatch');
 assert.equal(Object.keys(state.thingValues).length,0);
}
const pass=run({area:'主卧',model:'DQDZ-LC12'});
assert.equal(pass.output.grounding_status,'ALLOW');
assert.equal(Object.keys(pass.state.thingValues).length,1);
console.log('PASS actual room inventory required for capability binding; wrong-room model never writes');
