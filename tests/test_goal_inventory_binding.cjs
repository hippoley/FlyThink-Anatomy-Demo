'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function retrieveCapabilities('),b=html.indexOf('\nfunction goalNeeds(',a);
assert(a>=0&&b>a,'retrieval implementation missing');
const env={
 CAPINDEX:{capabilities:[
  {capability_id:'wrong',model:'OTHER',module:'OTHER',kind:'p',ops:['write'],code:'brightness'},
  {capability_id:'right',model:'LIGHT',module:'MAIN',kind:'p',ops:['write'],code:'brightness'}
 ]},
 scoreCapability:c=>({score:c.capability_id==='wrong'?100:20,check:{ok:true},entity:'light',reasons:[]})
};
vm.createContext(env);
const retrieve=vm.runInContext(html.slice(a,b)+'\nretrieveCapabilities',env);
const need={entity:'light',property:'brightness',value:30,model_code:'LIGHT',module_code:'MAIN'};
assert.equal(retrieve('movie_comfort','看电影',need).accepted[0].capability.capability_id,'right');
assert.equal(retrieve('movie_comfort','看电影',{...need,module_code:'ABSENT'}).accepted.length,0);
assert.equal(retrieve('movie_comfort','看电影',{...need,model_code:'ABSENT'}).accepted.length,0);
console.log('PASS hard inventory model/module binding and fail-closed mismatch');
