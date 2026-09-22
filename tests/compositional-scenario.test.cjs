const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('const AREA_ALIASES=');
const end=html.indexOf('function capabilityText(',start);
assert.ok(start>=0&&end>start);
const ctx=vm.createContext({state:{lastArea:'客厅'}});
vm.runInContext(html.slice(start,end),ctx);

test('separates room-scoped goals into independent needs',()=>{
  const s=ctx.composeGoalScenario('客厅太亮，主卧太暗');
  assert.deepEqual([...s.scope],['客厅','主卧']);
  assert.ok(s.needs.some(x=>x.area==='客厅'&&x.entity==='light'&&x.property==='brightness'&&x.value===30));
  assert.ok(s.needs.some(x=>x.area==='主卧'&&x.entity==='light'&&x.property==='brightness'&&x.value===70));
  assert.equal(s.conflicts.length,0);
});

test('turns stuffy plus rain and no-open-window into fresh-air actions',()=>{
  const s=ctx.composeGoalScenario('主卧很闷，外面下雨了，我不想开窗');
  assert.ok(s.needs.some(x=>x.area==='主卧'&&x.entity==='air'&&x.property==='power'&&x.value===true));
  assert.ok(s.needs.some(x=>x.area==='主卧'&&x.entity==='air'&&x.property==='fanLevel'));
  assert.equal(s.needs.some(x=>x.entity==='window'),false);
  assert.ok(s.constraints.some(x=>x.entity==='window'&&x.type==='forbid'));
});

test('does not leak one room signal into another room',()=>{
  const s=ctx.composeGoalScenario('客厅太亮，书房很闷');
  assert.equal(s.needs.some(x=>x.area==='客厅'&&x.entity==='air'),false);
  assert.ok(s.needs.some(x=>x.area==='书房'&&x.entity==='window'));
});

test('detects contradictory values in the same room and property',()=>{
  const s=ctx.composeGoalScenario('客厅太亮，但是客厅太暗');
  assert.ok(s.conflicts.some(x=>x.key==='客厅::light::brightness'));
});

test('whole-home leave intent expands to multiple rooms and objects',()=>{
  const s=ctx.composeGoalScenario('我要离家了，全屋的灯关掉，窗也关好');
  assert.ok(s.scope.length>=5);
  assert.ok(new Set(s.needs.map(x=>x.area)).size>=5);
  assert.ok(s.needs.some(x=>x.entity==='light'));
  assert.ok(s.needs.some(x=>x.entity==='window'));
});
