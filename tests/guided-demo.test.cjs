"use strict";

const fs=require("fs");
const assert=require("assert");

const html=fs.readFileSync("index.html","utf8");

for(const token of [
  "3-turn guided demo",
  "PLAYGROUND MODE · browser simulation · no physical write",
  'data-guided-turn="把客厅灯打开"',
  'data-guided-turn="调到30%"',
  'data-guided-turn="关掉"',
  "function prepareGuidedTurn(button)",
  "persistent focus",
  "real hardware golden proof: PENDING"
]){
  assert.ok(html.includes(token),"missing guided-demo token: "+token);
}

assert.ok(
  html.indexOf("3-turn guided demo") < html.indexOf('<main class="stage" id="experience">'),
  "guided path must appear before the primary playground panels"
);

assert.ok(
  html.includes("(e.ctrlKey||e.metaKey)&&e.key==='Enter'"),
  "composer must support Ctrl/Cmd+Enter"
);

console.log(JSON.stringify({
  ok:true,
  contract:"guided demo exposes a deliberate 3-turn context story without claiming physical execution"
}));
