"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {normalizeRuntime} = require("../scripts/whole_home_patch_contract.cjs");
const {
  loadBindings,
  InMemoryThingTransport,
  executeSemanticTurn
} = require("../scripts/physical_runtime_protocol.cjs");

const bindings = loadBindings();
const LIGHT = {area:"客厅", entity:"灯", instance:"default"};
const WINDOW = {area:"客厅", entity:"窗户", instance:"default"};

function baseRuntime() {
  return normalizeRuntime({
    devices: {
      "客厅::灯::default": {
        key:"客厅::灯::default",
        area:"客厅",
        entity:"灯",
        instance:"default",
        model_id:"DQDZ-Y15R",
        slots:{power:"ON", brightness:80},
        physical_binding:{
          entity_id:"physical_dev_home_001.light.rgb01",
          semantic_role:"light"
        }
      },
      "客厅::窗户::default": {
        key:"客厅::窗户::default",
        area:"客厅",
        entity:"窗户",
        instance:"default",
        model_id:"CWDS-CA01",
        slots:{opening:100},
        physical_binding:{
          entity_id:"physical_dev_home_001.window.combo01",
          semantic_role:"exterior_window"
        }
      }
    }
  });
}

test("safe committed light command executes through Thing binding then reconciles observation", () => {
  const transport = new InMemoryThingTransport(bindings);
  const out = executeSemanticTurn({
    runtime:baseRuntime(),
    proposal:{decision:"EXECUTE", patches:[{op:"CLOSE_DEVICE", target:LIGHT}]},
    commit_state:"SAFE_TO_COMMIT",
    transport,
    bindings
  });
  assert.equal(out.outcome, "EXECUTE");
  assert.equal(out.physical_status, "CONFIRMED");
  assert.equal(out.runtime.devices["客厅::灯::default"].slots.power, "OFF");
  assert.equal(out.runtime.devices["客厅::窗户::default"].slots.opening, 100);
  assert.equal(transport.write_count, 1);
  assert.equal(out.receipts[0].action_name, "living_color_light_off");
});

test("unsafe streaming hypothesis cannot touch physical transport", () => {
  const transport = new InMemoryThingTransport(bindings);
  const before = baseRuntime();
  const out = executeSemanticTurn({
    runtime:before,
    proposal:{decision:"EXECUTE", patches:[{op:"CLOSE_DEVICE", target:LIGHT}]},
    commit_state:"UNSTABLE",
    transport,
    bindings
  });
  assert.equal(out.outcome, "BLOCK");
  assert.equal(out.reason, "commit_not_safe");
  assert.equal(transport.write_count, 0);
  assert.deepEqual(out.runtime.devices, before.devices);
});

test("range-backed property accepts a dynamic value not predeclared as an action", () => {
  const transport = new InMemoryThingTransport(bindings);
  const out = executeSemanticTurn({
    runtime:baseRuntime(),
    proposal:{decision:"EXECUTE", patches:[{op:"PATCH_SLOT", target:LIGHT, slot:"brightness", value:50}]},
    commit_state:"SAFE_TO_COMMIT",
    transport,
    bindings
  });
  assert.equal(out.outcome, "EXECUTE");
  assert.equal(out.physical_status, "CONFIRMED");
  assert.equal(out.runtime.devices["客厅::灯::default"].slots.brightness, 50);
  assert.equal(out.receipts[0].command.value, 50);
  assert.match(out.receipts[0].action_name, /:dynamic$/);
});

test("out-of-range physical value blocks before transport write", () => {
  const transport = new InMemoryThingTransport(bindings);
  const out = executeSemanticTurn({
    runtime:baseRuntime(),
    proposal:{decision:"EXECUTE", patches:[{op:"PATCH_SLOT", target:LIGHT, slot:"brightness", value:0}]},
    commit_state:"SAFE_TO_COMMIT",
    transport,
    bindings
  });
  assert.equal(out.outcome, "BLOCK");
  assert.equal(out.reason, "physical_value_contract_violation");
  assert.equal(transport.write_count, 0);
});

test("device feedback wins over desired state on state-bearing property mismatch", () => {
  const transport = new InMemoryThingTransport(bindings, {drop_writes:true});
  const out = executeSemanticTurn({
    runtime:baseRuntime(),
    proposal:{decision:"EXECUTE", patches:[{op:"PATCH_SLOT", target:LIGHT, slot:"brightness", value:30}]},
    commit_state:"SAFE_TO_COMMIT",
    transport,
    bindings
  });
  assert.equal(out.outcome, "EXECUTE");
  assert.equal(out.physical_status, "MISMATCH");
  assert.equal(out.runtime.devices["客厅::灯::default"].slots.brightness, 80);
  assert.equal(out.runtime.devices["客厅::灯::default"].physical.desired.value, 30);
  assert.equal(out.runtime.devices["客厅::灯::default"].physical.observed.value, 80);
});

test("window close reconciles from real motorCurrentPosition feedback", () => {
  const transport = new InMemoryThingTransport(bindings);
  const out = executeSemanticTurn({
    runtime:baseRuntime(),
    proposal:{decision:"EXECUTE", patches:[{op:"CLOSE_DEVICE", target:WINDOW}]},
    commit_state:"SAFE_TO_COMMIT",
    transport,
    bindings
  });
  assert.equal(out.outcome, "EXECUTE");
  assert.equal(out.physical_status, "CONFIRMED");
  assert.equal(out.runtime.devices["客厅::窗户::default"].slots.opening, 0);
  assert.equal(out.receipts[0].feedback.code, "motorCurrentPosition");
  assert.equal(out.runtime.devices["客厅::灯::default"].slots.power, "ON");
});

test("window target position compiles to motorTargetPosition and reconciles measured position", () => {
  const transport = new InMemoryThingTransport(bindings);
  const out = executeSemanticTurn({
    runtime:baseRuntime(),
    proposal:{decision:"EXECUTE", patches:[{op:"PATCH_SLOT", target:WINDOW, slot:"opening", value:30}]},
    commit_state:"SAFE_TO_COMMIT",
    transport,
    bindings
  });
  assert.equal(out.outcome, "EXECUTE");
  assert.equal(out.physical_status, "CONFIRMED");
  assert.equal(out.receipts[0].command.code, "motorTargetPosition");
  assert.equal(out.receipts[0].command.value, 30);
  assert.equal(out.receipts[0].feedback.code, "motorCurrentPosition");
  assert.equal(out.runtime.devices["客厅::窗户::default"].slots.opening, 30);
});

test("relative window action uses reconciled state then commits an absolute target", () => {
  const transport = new InMemoryThingTransport(bindings);
  const out = executeSemanticTurn({
    runtime:baseRuntime(),
    proposal:{decision:"EXECUTE", patches:[{op:"PATCH_RELATIVE", target:WINDOW, slot:"opening", delta:-20}]},
    commit_state:"SAFE_TO_COMMIT",
    transport,
    bindings
  });
  assert.equal(out.outcome, "EXECUTE");
  assert.equal(out.physical_status, "CONFIRMED");
  assert.deepEqual(out.receipts[0].relative_resolution, {
    source_op:"PATCH_RELATIVE",
    observed_base:100,
    absolute_value:80
  });
  assert.equal(out.receipts[0].command.value, 80);
  assert.equal(out.runtime.devices["客厅::窗户::default"].slots.opening, 80);
});

test("measured physical feedback overrides desired window target on mismatch", () => {
  const feedbackKey = "physical_dev_home_001.window.combo01::CWDS-CA01|motor_1|property|motorCurrentPosition";
  const transport = new InMemoryThingTransport(bindings, {read_overrides:{[feedbackKey]:40}});
  const out = executeSemanticTurn({
    runtime:baseRuntime(),
    proposal:{decision:"EXECUTE", patches:[{op:"PATCH_SLOT", target:WINDOW, slot:"opening", value:30}]},
    commit_state:"SAFE_TO_COMMIT",
    transport,
    bindings
  });
  assert.equal(out.outcome, "EXECUTE");
  assert.equal(out.physical_status, "MISMATCH");
  assert.equal(out.runtime.devices["客厅::窗户::default"].slots.opening, 40);
  assert.equal(out.runtime.devices["客厅::窗户::default"].physical.desired.semantic.value, 30);
  assert.equal(out.runtime.devices["客厅::窗户::default"].physical.observed.semantic_value, 40);
});

test("without an explicit feedback binding motor command echo is never treated as measured position", () => {
  const noFeedback = JSON.parse(JSON.stringify(bindings));
  delete noFeedback.feedback;
  const transport = new InMemoryThingTransport(noFeedback);
  const out = executeSemanticTurn({
    runtime:baseRuntime(),
    proposal:{decision:"EXECUTE", patches:[{op:"CLOSE_DEVICE", target:WINDOW}]},
    commit_state:"SAFE_TO_COMMIT",
    transport,
    bindings:noFeedback
  });
  assert.equal(out.outcome, "EXECUTE");
  assert.equal(out.physical_status, "OBSERVATION_PENDING");
  assert.equal(out.runtime.devices["客厅::窗户::default"].slots.opening, 100);
  assert.equal(out.runtime.devices["客厅::窗户::default"].physical.status, "COMMAND_CONFIRMED_OBSERVATION_PENDING");
});
