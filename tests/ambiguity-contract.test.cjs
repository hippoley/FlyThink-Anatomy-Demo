const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('index.html','utf8');
function source(start,end){const at=html.indexOf(start),to=html.indexOf(end,at);assert.ok(at>=0&&to>at);return html.slice(at,to)}
function runtime(){
  const state={turn:2,nodeSeq:0,taskSeq:0,tasks:[],activeTask:null,paused:[],revisions:[],focus:'window',focusKey:'书房::书房外窗',lastArea:'书房',lastAction:'exterior_window_open',intentTree:{
    '书房::书房外窗':{instance_key:'书房::书房外窗',area:'书房',entity:'window',entity_name:'书房外窗',status:'active',properties:{motorControl:{value:0}}}
  },lastDelta:null};
  const c=vm.createContext({state,clone:x=>JSON.parse(JSON.stringify(x)),
    updateDecisionHeads:()=>({entity:{label:'none'},operation:{label:'none'},ood:0,ambiguity:0}),
    inferScenario:()=>null});
  vm.runInContext(source('function newNode(', 'const SLOT_SYNONYMS='),c);
  vm.runInContext(source('const SLOT_SYNONYMS=', 'function canonicalEntityName('),c);
  vm.runInContext(source('function canonicalEntityName(', 'const SCENARIOS='),c);
  vm.runInContext(source('function parseUtterance(', 'const THING_MODEL_SOURCE_SHA256='),c);
  return c;
}

const primary=(c,text)=>c.analyzeAmbiguity(text).primary;
test('missing room does not silently fall back to lastArea',()=>{
  const c=runtime();
  assert.equal(primary(c,'开灯'),'ROOM_AMBIGUITY');
  assert.equal(primary(c,'把灯打开'),'ROOM_AMBIGUITY');
});
test('generic bedroom and room-only actions produce targeted clarification',()=>{
  const c=runtime();
  assert.equal(primary(c,'卧室灯打开'),'ROOM_AMBIGUITY');
  assert.equal(primary(c,'客厅打开'),'OBJECT_AMBIGUITY');
});
test('relative values and unbounded all-scope are not invented',()=>{
  const c=runtime();
  assert.equal(primary(c,'客厅灯调暗一点'),'VALUE_AMBIGUITY');
  assert.equal(primary(c,'全都关掉'),'TARGET_AMBIGUITY');
});
test('multiple recent referents make 它 ambiguous',()=>{
  const c=runtime();
  c.state.lastDelta={nodes:[
    {node_id:'1',intent:'TurnOn',target:{entity:'light'},slots:{area:'客厅',entity_name:'客厅主灯'}},
    {node_id:'2',intent:'TurnOn',target:{entity:'window'},slots:{area:'书房',entity_name:'书房外窗'}}
  ]};
  const result=c.analyzeAmbiguity('把它关掉');
  assert.equal(result.primary,'REFERENT_AMBIGUITY');
  assert.deepEqual(Array.from(result.candidates.target),['客厅主灯','书房外窗']);
});
test('safe focused shorthand stays resolvable',()=>{
  const c=runtime();
  assert.equal(c.analyzeAmbiguity('关掉').decision,'RESOLVE');
  assert.equal(c.analyzeAmbiguity('调到30%').decision,'RESOLVE');
});
test('compound cancellation language is not collapsed into CANCEL_TASK',()=>{
  const c=runtime();
  const d=c.deltaFor('算了关了吧，再把窗打开');
  assert.equal(d.op,'CREATE_TASK');
  assert.equal(d.commit_policy,'never_commit');
  assert.equal(d.nodes[0].slots.reason,'structured_ambiguity');
  assert.equal(d.nodes[0].slots.original_utterance,'算了关了吧，再把窗打开');
  assert.equal(d.nodes[0].slots.unresolved_clauses.length,2);
  assert.equal(d.nodes[0].slots.ambiguity_types.includes('COMPOUND_TARGET_AMBIGUITY'),true);
  c.applyDelta(d);
  assert.equal(c.state.intentTree['书房::书房外窗'].properties.motorControl.value,0);
  assert.equal(c.state.focusKey,'书房::书房外窗');
  assert.equal(Object.values(c.state.intentTree).filter(x=>x.status==='pending_clarification').length,1);
});

test('opposite operations in different rooms do not create a false conflict',()=>{
  const c=runtime();
  assert.equal(c.analyzeAmbiguity('打开客厅灯，关掉主卧灯').decision,'RESOLVE');
  assert.equal(primary(c,'打开客厅灯，关掉客厅灯'),'OPERATION_CONFLICT');
});

test('multi-room result followed by 开灯 produces pending turn without a write',()=>{
  const c=runtime();
  c.state.intentTree['客厅::客厅主灯']={instance_key:'客厅::客厅主灯',area:'客厅',entity:'light',entity_name:'客厅主灯',status:'active',properties:{brightness:{value:30}}};
  c.state.intentTree['主卧::主卧主灯']={instance_key:'主卧::主卧主灯',area:'主卧',entity:'light',entity_name:'主卧主灯',status:'active',properties:{brightness:{value:70}}};
  const before=JSON.stringify(c.state.intentTree);
  const d=c.deltaFor('开灯');
  assert.equal(d.commit_policy,'never_commit');
  assert.equal(d.nodes[0].slots.ambiguity_types.includes('ROOM_AMBIGUITY'),true);
  c.applyDelta(d);
  for(const key of ['客厅::客厅主灯','主卧::主卧主灯','书房::书房外窗']){
    assert.deepEqual(JSON.parse(JSON.stringify(c.state.intentTree[key])),JSON.parse(before)[key]);
  }
  assert.equal(c.state.focusKey,'书房::书房外窗');
});
