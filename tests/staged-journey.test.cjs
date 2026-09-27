const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('keeps one primary conversation form and one staged result path', () => {
  assert.equal((html.match(/id="composer"/g) || []).length, 1);
  assert.equal((html.match(/id="turnStageRail"/g) || []).length, 1);
  assert.match(html, /runTurnJourney\(text,d,exec,neural\)/);
});

test('exposes the five user-facing phases without promoting research tools', () => {
  for (const label of ['原句进入', '结构理解', '状态提交', '约束校验', '家中变化']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /浏览器运行时 · v14 训练证据另行标注/);
  assert.match(html, /训练证据，非本网页推理/);
});

test('stage interaction is inspectable and reset-safe', () => {
  assert.match(html, /data-turn-stage/);
  assert.match(html, /selectTurnJourneyStage/);
  assert.match(html, /turnJourneyTimers\.forEach\(clearTimeout\)/);
  assert.match(html, /\$\('#turnJourney'\)\.hidden=true/);
});


test('keeps a visible whole-home state surface on the primary result path', () => {
  assert.equal((html.match(/id="homeRoomGrid"/g) || []).length, 1);
  assert.match(html, /function renderHomeStage\(exec=null\)/);
  assert.match(html, /HOME_AREAS\.map\(area=>/);
  assert.match(html, /HOME_INVENTORY\[area\]/);
  assert.match(html, /homeDeviceChip\.changed/);
  assert.match(html, /applyVisibleHomeOutputs\(exec\);renderHomeStage\(exec\)/);
});

test('turn suggestions are directly playable instead of passive copy', () => {
  assert.match(html, /data-next-prompt/);
  assert.match(html, /\$\('#nextHint'\)\.addEventListener\('click'/);
  assert.match(html, /b\.dataset\.nextPrompt/);
  assert.match(html, /if\(!restorePersistedSession\(\)\)resetHomeResult\(\)/);
});


test('whole-home device chips load context-aware probes into the primary composer', () => {
  assert.match(html, /function homeProbeText\(area,entity\)/);
  assert.match(html, /function loadHomeProbe\(area,entity\)/);
  assert.match(html, /data-home-probe/);
  assert.match(html, /\$\('#homeRoomGrid'\)\.addEventListener\('click'/);
  assert.match(html, /外面下雨了，不想开窗/);
});
