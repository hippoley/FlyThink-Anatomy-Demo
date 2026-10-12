'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('if(/做一样的|照刚才/.test(p)){');
const end=html.indexOf('\n    else if(/查询',start);
assert(start>=0&&end>start,'cross-room inheritance block missing');
const block=html.slice(start,end);
function check(entity,source,expected){
  const ctx={
    p:'主卧那个也做一样的',entity,intent:null,slots:{},focusedBefore:null,
    previousIntent:null,
    activeTask:()=>({nodes:source?[source]:[]}),
    intentFromLastAction:()=>null
  };
  vm.createContext(ctx);
  const result=vm.runInContext('(()=>{'+block+';return {entity,intent,slots}})()',ctx);
  assert.equal(result.intent,expected?.intent||null);
  assert.equal(result.entity,expected?.entity||null);
  if(expected){
    assert.equal(result.slots.property,expected.property);
    assert.equal(result.slots.value,expected.value);
    assert.equal(result.slots.area,undefined,'previous room must not be copied');
    assert.equal(result.slots.entity_name,undefined,'previous device instance must not be copied');
  }
}
check('window',{target:{entity:'window'},intent:'TurnOff',slots:{area:'客厅',entity_name:'客厅外窗',property:'motorControl',value:1}},{entity:'window',intent:'TurnOff',property:'motorControl',value:1});
check('light',{target:{entity:'light'},intent:'SetValue',slots:{area:'客厅',entity_name:'客厅灯',property:'brightness',value:30}},{entity:'light',intent:'SetValue',property:'brightness',value:30});
check('window',null,null);
console.log('PASS cross-room inherits operation/value without previous device identity and rejects missing context');
