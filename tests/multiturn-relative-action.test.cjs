const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('index.html','utf8');
function source(start,end){
  const at=html.indexOf(start);assert.notEqual(at,-1,'missing '+start);
  const to=html.indexOf(end,at);assert.notEqual(to,-1,'missing '+end);
  return html.slice(at,to);
}
function parserRuntime(){
  const state={turn:0,nodeSeq:0,focus:null,focusKey:null,lastArea:'客厅',lastAction:null,intentTree:{}};
  const ctx=vm.createContext({
    state,
    updateDecisionHeads:()=>({entity:{label:'none'},operation:{label:'none'},ood:0,ambiguity:0}),
    inferScenario:()=>null,
    buildGoalPlan:()=>{throw new Error('scenario compiler should not run')}
  });
  vm.runInContext(source('function newNode(', 'function taskById('),ctx);
  vm.runInContext(source('function focusedTreeNode(', 'function mergeSemanticNode('),ctx);
  vm.runInContext(source('const SLOT_SYNONYMS=', 'const HOME_AREAS='),ctx);
  vm.runInContext(source('const HOME_AREAS=', 'function canonicalEntityName('),ctx);
  vm.runInContext(source('function canonicalEntityName(', 'const SCENARIOS='),ctx);
  vm.runInContext(source('function parseUtterance(', 'function deltaFor('),ctx);
  return ctx;
}
function mountFocus(ctx,node){
  const key=node.slots.area+'::'+node.slots.entity_name;
  ctx.state.focus=node.target.entity;
  ctx.state.focusKey=key;
  ctx.state.lastArea=node.slots.area;
  ctx.state.intentTree[key]={instance_key:key,area:node.slots.area,entity:node.target.entity,entity_name:node.slots.entity_name,properties:{[node.slots.property]:{value:node.slots.value}}};
}

test('关掉 patches the focused light instead of producing an empty turn',()=>{
  const c=parserRuntime();
  const first=c.parseUtterance('把客厅灯打开');
  assert.equal(first.nodes.length,1);mountFocus(c,first.nodes[0]);
  const second=c.parseUtterance('关掉');
  assert.equal(second.nodes.length,1);
  assert.equal(second.nodes[0].target.entity,'light');
  assert.equal(second.nodes[0].slots.area,'客厅');
  assert.equal(second.nodes[0].slots.property,'power');
  assert.equal(second.nodes[0].slots.value,false);
  assert.equal(second.nodes[0].slots.reference_source,'persistent_focus');
});

test('调到30% inherits the focused light and selects brightness',()=>{
  const c=parserRuntime();
  const first=c.parseUtterance('把客厅灯打开');mountFocus(c,first.nodes[0]);
  const second=c.parseUtterance('调到30%');
  assert.equal(second.nodes.length,1);
  assert.equal(second.nodes[0].target.entity,'light');
  assert.equal(second.nodes[0].slots.area,'客厅');
  assert.equal(second.nodes[0].slots.property,'brightness');
  assert.equal(second.nodes[0].slots.value,30);
});

test('bare action without focus remains unresolved',()=>{
  const c=parserRuntime();
  const turn=c.parseUtterance('关掉');
  assert.equal(turn.type,'clarify');
  assert.equal(turn.nodes[0].slots.ambiguity_types.includes('TARGET_AMBIGUITY'),true);
});

test('interaction events persist locally and clear only on explicit reset',()=>{
  const values=new Map();
  const localStorage={
    setItem:(key,value)=>values.set(key,String(value)),
    getItem:key=>values.has(key)?values.get(key):null,
    removeItem:key=>values.delete(key)
  };
  const state={sessionEvents:[{turn_id:'turn:1',text:'把客厅灯打开',at:'2026-09-23T00:00:00.000Z',delta:{op:'CREATE_TASK'},reply:'客厅主灯 · 电源：开启',world_deltas:[]}]};
  const ctx=vm.createContext({window:{localStorage},state,$:()=>({value:'revise'}),Date,JSON});
  vm.runInContext("const SESSION_STORAGE_KEY='flythink.runtime.session.v1';"+source('function browserSessionStorage(', 'function submit('),ctx);
  assert.equal(ctx.persistSession(),true);
  assert.equal(ctx.readPersistedSession().events[0].text,'把客厅灯打开');
  assert.equal(ctx.readPersistedSession().scene,'revise');
  ctx.clearPersistedSession();
  assert.equal(ctx.readPersistedSession(),null);
});

test('wrong result retains its original trace and a later turn is only a candidate correction',()=>{
  const values=new Map();
  const localStorage={setItem:(k,v)=>values.set(k,String(v)),getItem:k=>values.get(k)||null,removeItem:k=>values.delete(k)};
  const elements={
    '#sceneSelect':{value:'roomGoals'},'#failureCount':{textContent:''},
    '#markWrong':{textContent:'',disabled:false}
  };
  const original={event_id:'event:1',turn_id:'turn:2',text:'开灯',at:'2026-09-23T00:00:00.000Z',before:{focusKey:'书房::书房外窗'},delta:{op:'CREATE_TASK'},reply:'书房主灯 · 电源：开启',world_deltas:[{key:'书房主灯.power',after:true}]};
  const state={sessionEvents:[original],lastEventId:'event:1',failureEvents:[]};
  const c=vm.createContext({window:{localStorage},state,$:s=>elements[s]||null,Date,JSON,clone:x=>JSON.parse(JSON.stringify(x))});
  vm.runInContext("const SESSION_STORAGE_KEY='flythink.runtime.session.v1',FAILURE_STORAGE_KEY='flythink.runtime.failures.v1';"+source('function browserSessionStorage(', 'function restorePersistedSession('),c);
  c.markLastResultWrong();
  assert.equal(c.state.failureEvents[0].reply,'书房主灯 · 电源：开启');
  assert.equal(c.state.failureEvents[0].before.focusKey,'书房::书房外窗');
  c.linkPendingCorrection('客厅的灯关掉');
  assert.equal(c.state.failureEvents[0].correction_candidate.label,'candidate_not_gold');
  const second=vm.createContext({window:{localStorage},state:{failureEvents:[]},$:s=>elements[s]||null,Date,JSON});
  vm.runInContext("const SESSION_STORAGE_KEY='flythink.runtime.session.v1',FAILURE_STORAGE_KEY='flythink.runtime.failures.v1';"+source('function browserSessionStorage(', 'function restorePersistedSession('),second);
  assert.equal(second.loadFailureLibrary()[0].reply,'书房主灯 · 电源：开启');
});
