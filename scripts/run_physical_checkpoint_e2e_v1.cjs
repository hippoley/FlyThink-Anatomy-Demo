"use strict";

const cp = require("child_process");
const readline = require("readline");
const {normalizeRuntime} = require("./whole_home_patch_contract.cjs");
const {deriveContext} = require("./runtime_context_adapter.cjs");
const {
  loadBindings,
  InMemoryThingTransport,
  executeSemanticTurn
} = require("./physical_runtime_protocol.cjs");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const args = {
    graph: arg("--graph"),
    judgement: arg("--judgement"),
    semantic: arg("--semantic")
  };
  if (!args.graph || !args.judgement || !args.semantic) throw new Error("graph_judgement_semantic_required");

  const LIGHT = {area:"客厅", entity:"灯", instance:"default"};
  let runtime = normalizeRuntime({
    devices:{
      "客厅::灯::default":{
        key:"客厅::灯::default",
        area:"客厅",
        entity:"灯",
        instance:"default",
        status:"mounted",
        model_id:"DQDZ-Y15R",
        slots:{power:"ON", brightness:80},
        physical_binding:{
          entity_id:"physical_dev_home_001.light.rgb01",
          semantic_role:"light"
        }
      }
    }
  });

  const bindings = loadBindings();
  const transport = new InMemoryThingTransport(bindings);
  const py = cp.spawn("python", [
    "scripts/checkpoint_jsonl_server.py",
    "--graph", args.graph,
    "--judgement", args.judgement,
    "--semantic", args.semantic
  ], {stdio:["pipe","pipe","inherit"]});

  const rl = readline.createInterface({input:py.stdout});
  const queue = [];
  rl.on("line", line => {
    const q = queue.shift();
    if (q) q(JSON.parse(line));
  });
  const predict = x => new Promise(resolve => {
    queue.push(resolve);
    py.stdin.write(JSON.stringify(x) + "\n");
  });

  const turns = [
    {text:"客厅灯关掉", context_hint:{focused_target:LIGHT}, expect:{power:"OFF"}},
    {text:"再打开", expect:{power:"ON"}},
    {text:"亮度调到30", expect:{brightness:30}}
  ];

  const history = [];
  const report = [];
  let confirmed = 0;

  for (const turn of turns) {
    const context = {...deriveContext(runtime, history), ...(turn.context_hint || {})};
    const pred = await predict({text:turn.text, context, background:context});
    const result = executeSemanticTurn({
      runtime,
      proposal:pred,
      commit_state:"SAFE_TO_COMMIT",
      transport,
      bindings
    });
    runtime = result.runtime;
    const slots = runtime.devices["客厅::灯::default"].slots;
    const state_ok = Object.entries(turn.expect).every(([k,v]) => JSON.stringify(slots[k]) === JSON.stringify(v));
    if (state_ok && result.outcome === "EXECUTE" && result.physical_status === "CONFIRMED") confirmed++;
    history.push({
      text:turn.text,
      outcome:result.outcome,
      applied_patches:result.outcome === "EXECUTE" ? (pred.patches || []) : [],
      physical_status:result.physical_status
    });
    report.push({
      text:turn.text,
      predicted_decision:pred.decision,
      patches:pred.patches || [],
      outcome:result.outcome,
      physical_status:result.physical_status,
      state_ok,
      slots:{...slots}
    });
  }

  py.stdin.end();
  const out = {
    truth:"checkpoint_to_commit_gate_to_thing_binding_to_feedback_reconcile_v1",
    turns:turns.length,
    confirmed_turns:confirmed,
    all_confirmed:confirmed === turns.length,
    transport_writes:transport.write_count,
    final_slots:runtime.devices["客厅::灯::default"].slots,
    turns_detail:report
  };
  console.log(JSON.stringify(out));
  if (!out.all_confirmed) process.exitCode = 2;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
