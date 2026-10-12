'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function extract(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a);
 assert(a>=0&&b>a,'missing browser integration code '+start);
 return html.slice(a,b);
}
const binding=extract('function bindingForCapability(','\nfunction routeNode(');
const execute=extract('function executeCurrent(','\nconst STARTER_SCENES=');
function run(tampered){
 const cap={capability_id:'cap1',model:'LIGHT',module:'MAIN',code:'brightness',kind:'p',ops:['write'],product:'灯'};
 const node={intent:'SetValue',target:{entity:'light'},slots:{capability_id:'cap1',area:'客厅',value:30,model_code:tampered?'OTHER':'LIGHT',module_code:'MAIN',schema_property:'brightness'}};
 const state={thingValues:{},lastArea:'客厅'};
 const ctx={state,CAPINDEX:{truth:'fixture'},THING_MODEL_SOURCE_SHA256:'fixture',
 capabilityById:()=>cap,capabilityValueCheck:()=>({ok:true}),canonicalEntityName:()=> '客厅灯',
 nodesForCurrentTurn:()=>[node],routeNode:()=>({route:'THING_MODEL_EXECUTE',action:'capability:cap1'}),
 bindingForAction:()=>{throw Error('unexpected fallback')},bindingForQuery:()=>{throw Error('unexpected query')}};
 vm.createContext(ctx);
 const output=vm.runInContext(binding+'\n'+execute+'\nexecuteCurrent({}, {op:"CREATE_TASK"})',ctx);
 return {output,state};
}
const blocked=run(true);
assert.equal(blocked.output.outputs[0].grounding_status,'BLOCKED');
assert.deepEqual(blocked.output.worldDeltas,[]);
assert.deepEqual(blocked.output.actions,[]);
assert.deepEqual(Object.keys(blocked.state.thingValues),[]);
const accepted=run(false);
assert.equal(accepted.output.outputs[0].grounding_status,'ALLOW');
assert.equal(accepted.output.worldDeltas.length,1);
assert.equal(Object.keys(accepted.state.thingValues).length,1);
console.log('PASS executeCurrent -> capability binding: mismatched model zero writes, valid model one simulated write');
