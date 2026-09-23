const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('index.html','utf8');
function source(start,end){const at=html.indexOf(start),to=html.indexOf(end,at);assert.ok(at>=0&&to>at);return html.slice(at,to)}
function runtime(){
  const state={turn:2,nodeSeq:0,focus:'window',focusKey:'书房::书房外窗',lastArea:'书房',lastAction:'exterior_window_open',intentTree:{
    '书房::书房外窗':{instance_key:'书房::书房外窗',area:'书房',entity:'window',entity_name:'书房外窗',status:'active',properties:{motorControl:{value:0}}}
  },lastDelta:null};
  const c=vm.createContext({state});
  vm.runInContext(source('function instanceKey(', 'function nodePropertyKey('),c);
  vm.runInContext(source('function focusedTreeNode(', 'function mergeSemanticNode('),c);
  vm.runInContext(source('const SLOT_SYNONYMS=', 'function canonicalEntityName('),c);
  vm.runInContext(source('function canonicalEntityName(', 'const SCENARIOS='),c);
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
  assert.match(html,/const isCancel=\/\^\(\?:算了/);
  assert.match(html,/OPERATION_CONFLICT/);
  assert.doesNotMatch(html,/const isCancel=\/算了\|取消/);
});
