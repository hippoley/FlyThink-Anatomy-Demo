const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const zlib=require('node:zlib');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const ctx=vm.createContext({});
vm.runInContext(section('function capabilityValueCheck(', 'function semanticPropertyAliases'),ctx);
const check=ctx.capabilityValueCheck;
const prop={kind:'p',ops:['read','write'],dataType:'uint8',min:0,max:100,enum:[]};
test('writes reject absent, nonfinite, coerced and fractional values',()=>{
 for(const value of [undefined,null,NaN,Infinity,-Infinity,'30',true,1.5])assert.equal(check(prop,value).ok,false,String(value));
 for(const value of [0,30,100])assert.equal(check(prop,value).ok,true);
 assert.equal(check(prop,101).reason,'above_maximum');
 assert.equal(check({...prop,min:null,max:null},256).reason,'datatype_integer_range');
 assert.equal(check({...prop,min:null,max:null},-1).reason,'datatype_integer_range');
});
test('read, events, services, missing schema and operations fail independently',()=>{
 assert.equal(check(prop,undefined,'read').ok,true);
 assert.equal(check({...prop,ops:['read']},30).reason,'write_permission_missing');
 assert.equal(check(null,1).reason,'capability_missing');
 assert.equal(check(prop,1,'delete').reason,'operation_unknown');
 assert.equal(check({...prop,kind:'e'},1,'read').reason,'event_not_command');
 assert.equal(check({...prop,kind:'s'}, {}, 'execute').reason,'service_input_schema_unavailable');
 assert.equal(check({...prop,dataType:'array'},[]).reason,'complete_value_schema_unavailable');
});
test('bool/string/enum remain strictly typed',()=>{
 assert.equal(check({...prop,dataType:'bool'},false).ok,true);
 assert.equal(check({...prop,dataType:'bool'},0).ok,false);
 assert.equal(check({...prop,dataType:'string'},'abc').ok,true);
 assert.equal(check({...prop,dataType:'string'},42).ok,false);
 const enumerated={...prop,enum:[{value:0},{value:2}]};
 assert.equal(check(enumerated,2).ok,true);
 assert.equal(check(enumerated,1).reason,'enum_value_not_allowed');
});
const index=JSON.parse(fs.readFileSync('_site/capability-index.json','utf8'));
const caps=index.rows.map(r=>Object.fromEntries(index.columns.map((k,i)=>[k,r[i]])));
test('public registry contains all 46 original schemas',()=>{
 const encoded=fs.readFileSync('data/real-home-thing-model-registry.json.gz.b64','utf8').replace(/\s/g,'');
 const registry=JSON.parse(zlib.gunzipSync(Buffer.from(encoded,'base64')));
 assert.equal(registry.full_schema_count,46);
 assert.equal(Object.keys(registry.full_models).length,46);
 assert.deepEqual(new Set(registry.model_index.map(x=>x.model_code)),new Set(Object.keys(registry.full_models)));
 for(const [code,schema] of Object.entries(registry.full_models)){
   assert.ok(schema.id,code);
   assert.ok(schema.title,code);
   assert.equal(typeof schema.modules,'object',code);
 }
});
test('all 794 real capabilities deny missing writes and schema-less service execution',()=>{
 assert.equal(caps.length,794);
 for(const c of caps){
   assert.equal(check(c,undefined,'write').ok,false,[c.model,c.code].join('/'));
   if(c.kind==='s')assert.equal(check(c,{},'execute').ok,false);
   if(c.kind==='p'&&c.ops.includes('read'))assert.equal(check(c,undefined,'read').ok,true);
 }
});
test('blocked execution cannot mutate session values',()=>{
 const cap={...prop,model:'test',module:'light',code:'brightness',capability_id:'test::light::p::brightness'};
 Object.assign(ctx,{capabilityById:()=>cap,state:{thingValues:{},lastArea:'客厅'},canonicalEntityName:()=> '客厅灯',THING_MODEL_SOURCE_SHA256:'test',CAPINDEX:{truth:'test'}});
 vm.runInContext(section('function bindingForCapability(', 'function routeNode('),ctx);
 for(const value of [undefined,null,NaN,1.5,101]){
   const result=ctx.bindingForCapability({slots:{capability_id:cap.capability_id,value},intent:'SetValue',target:{entity:'light'}});
   assert.equal(result.grounding_status,'BLOCKED');
   assert.equal(Object.keys(ctx.state.thingValues).length,0);
 }
 const result=ctx.bindingForCapability({slots:{capability_id:cap.capability_id,value:30},intent:'SetValue',target:{entity:'light'}});
 assert.equal(result.grounding_status,'ALLOW');
 assert.equal(Object.values(ctx.state.thingValues)[0],30);
});
