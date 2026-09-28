"use strict";

const fs = require("fs");
const path = require("path");
const {
  normalizeRuntime,
  deviceKey,
  diffLeaves
} = require("./whole_home_patch_contract.cjs");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function loadBindings(file = path.join(__dirname, "..", "data", "thing-model-runtime-bindings.json")) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data.actions || !data.initial_world) throw new Error("invalid_physical_runtime_bindings");
  return data;
}

function capabilityKey(action) {
  return [action.product_model, action.module, action.interaction, action.code].join("|");
}

function normalizePower(value) {
  if (value === true || value === "ON" || value === "on" || value === 1) return true;
  if (value === false || value === "OFF" || value === "off" || value === 0) return false;
  return null;
}

function roleFromEntity(entity = "") {
  const e = String(entity).toLowerCase();
  if (e.includes("纱") || e.includes("screen")) return "insect_screen";
  if (e.includes("窗") || e.includes("window")) return "exterior_window";
  if (e.includes("灯") || e.includes("light")) return "light";
  return null;
}

function requestFromPatch(patch) {
  const role = roleFromEntity(patch && patch.target && patch.target.entity);
  if (!patch || !patch.op || !patch.target || !role) {
    return {ok: false, reason: "unsupported_or_missing_semantic_target"};
  }

  if (patch.op === "CLOSE_DEVICE") {
    if (role === "light") return {ok: true, role, kind: "property", code: "power", value: false};
    if (role === "exterior_window" || role === "insect_screen") return {ok: true, role, kind: "verb", verb: "close"};
  }

  if (patch.op === "ADD_DEVICE") {
    const p = normalizePower((patch.slots || {}).power);
    if (role === "light" && p !== null) return {ok: true, role, kind: "property", code: "power", value: p};
    if ((role === "exterior_window" || role === "insect_screen") && p === true) return {ok: true, role, kind: "verb", verb: "open"};
  }

  if (patch.op === "PATCH_SLOT") {
    if (patch.slot === "power") {
      const p = normalizePower(patch.value);
      if (role === "light" && p !== null) return {ok: true, role, kind: "property", code: "power", value: p};
    }
    if (role === "light" && patch.slot === "brightness" && Number.isFinite(patch.value)) {
      return {ok: true, role, kind: "property", code: "brightness", value: patch.value};
    }
    if ((role === "exterior_window" || role === "insect_screen") && patch.slot === "opening") {
      if (patch.value === 0) return {ok: true, role, kind: "verb", verb: "close"};
      if (patch.value === 100) return {ok: true, role, kind: "verb", verb: "open"};
      return {ok: false, reason: "runtime_binding_has_no_position_setpoint"};
    }
  }

  return {ok: false, reason: "unsupported_semantic_patch_for_physical_binding"};
}

function boundDevice(runtime, target) {
  const d = (runtime.devices || {})[deviceKey(target)];
  if (!d || !d.physical_binding || !d.physical_binding.entity_id) {
    return {ok: false, reason: "unbound_physical_target"};
  }
  return {ok: true, device: d, binding: d.physical_binding};
}

function compilePatch(bindings, runtime, patch) {
  const req = requestFromPatch(patch);
  if (!req.ok) return {status: "BLOCKED", reason: req.reason, patch: clone(patch)};

  const bd = boundDevice(runtime, patch.target);
  if (!bd.ok) return {status: "BLOCKED", reason: bd.reason, patch: clone(patch)};

  if (bd.binding.semantic_role && bd.binding.semantic_role !== req.role) {
    return {status: "BLOCKED", reason: "semantic_role_binding_mismatch", patch: clone(patch)};
  }

  const actions = Object.entries(bindings.actions)
    .map(([name, action]) => ({name, ...action}))
    .filter(a => a.entity_id === bd.binding.entity_id && a.semantic_role === req.role);

  let candidates;
  if (req.kind === "verb") {
    candidates = actions.filter(a => a.name.endsWith("_" + req.verb));
  } else {
    candidates = actions.filter(a => a.code === req.code && JSON.stringify(a.value) === JSON.stringify(req.value));
  }

  if (candidates.length !== 1) {
    return {
      status: "BLOCKED",
      reason: candidates.length ? "physical_binding_not_unique" : "physical_binding_not_found",
      patch: clone(patch),
      request: req,
      candidates: candidates.map(x => x.name)
    };
  }

  const a = candidates[0];
  return {
    status: "GROUNDED",
    patch: clone(patch),
    action_name: a.name,
    command: {
      entity_id: a.entity_id,
      product_model: a.product_model,
      module: a.module,
      interaction: a.interaction,
      code: a.code,
      value: clone(a.value),
      semantic_role: a.semantic_role,
      capability_key: capabilityKey(a)
    }
  };
}

function commitGate(proposal, commitState) {
  if (!proposal || proposal.decision !== "EXECUTE") return {allow: false, reason: "decision_not_execute"};
  if (!["SAFE_TO_COMMIT", "COMMITTED"].includes(commitState)) return {allow: false, reason: "commit_not_safe"};
  if (Array.isArray(proposal.ambiguity) && proposal.ambiguity.length) return {allow: false, reason: "ambiguity_unresolved"};
  if (!Array.isArray(proposal.patches) || !proposal.patches.length) return {allow: false, reason: "no_physical_patch"};
  return {allow: true, reason: "safe_to_commit"};
}

class InMemoryThingTransport {
  constructor(bindings, options = {}) {
    this.world = clone(bindings.initial_world || {});
    this.write_count = 0;
    this.read_count = 0;
    this.drop_writes = !!options.drop_writes;
    this.read_overrides = clone(options.read_overrides || {});
  }

  write(command) {
    this.write_count++;
    if (!this.world[command.entity_id]) this.world[command.entity_id] = {};
    if (!this.drop_writes) this.world[command.entity_id][command.capability_key] = clone(command.value);
    return {accepted: true, command: clone(command)};
  }

  read(command) {
    this.read_count++;
    const overrideKey = command.entity_id + "::" + command.capability_key;
    if (Object.prototype.hasOwnProperty.call(this.read_overrides, overrideKey)) {
      return clone(this.read_overrides[overrideKey]);
    }
    return clone((this.world[command.entity_id] || {})[command.capability_key]);
  }

  snapshot() {
    return clone(this.world);
  }
}

function isStateBearing(command) {
  return command.code === "power" || command.code === "brightness" || command.code === "colorTemperature";
}

function reconcileObservation(runtime, compiled, observed) {
  const next = normalizeRuntime(runtime);
  const before = normalizeRuntime(runtime);
  const patch = compiled.patch;
  const key = deviceKey(patch.target);
  const d = next.devices[key];
  if (!d) throw new Error("reconcile_target_missing:" + key);

  d.physical = d.physical || {};
  d.physical.desired = {
    entity_id: compiled.command.entity_id,
    capability_key: compiled.command.capability_key,
    value: clone(compiled.command.value)
  };
  d.physical.observed = {
    entity_id: compiled.command.entity_id,
    capability_key: compiled.command.capability_key,
    value: clone(observed)
  };

  const equal = JSON.stringify(observed) === JSON.stringify(compiled.command.value);
  d.physical.status = equal
    ? (isStateBearing(compiled.command) ? "STATE_CONFIRMED" : "COMMAND_CONFIRMED_OBSERVATION_PENDING")
    : "MISMATCH";

  if (isStateBearing(compiled.command)) {
    if (compiled.command.code === "power" && typeof observed === "boolean") d.slots.power = observed ? "ON" : "OFF";
    if (compiled.command.code === "brightness" && Number.isFinite(observed)) d.slots.brightness = observed;
    if (compiled.command.code === "colorTemperature" && Number.isFinite(observed)) d.slots.color_temperature = observed;
  }

  const changed = diffLeaves(before.devices || {}, next.devices || {});
  const illegal = changed.filter(p => !(p === key || p.startsWith(key + "::")));
  if (illegal.length) throw new Error("reconcile_untouched_state_mutation:" + illegal.join(","));

  next.executionLedger.push({
    id: "physical:" + (next.executionLedger.length + 1),
    kind: "physical_observation",
    action_name: compiled.action_name,
    target: clone(patch.target),
    command: clone(compiled.command),
    observed: clone(observed),
    status: d.physical.status
  });
  return next;
}

function aggregateStatus(receipts) {
  if (receipts.some(r => r.status === "MISMATCH")) return "MISMATCH";
  if (receipts.some(r => r.status === "COMMAND_CONFIRMED_OBSERVATION_PENDING")) return "OBSERVATION_PENDING";
  return "CONFIRMED";
}

function executeSemanticTurn({runtime, proposal, commit_state, transport, bindings}) {
  const gate = commitGate(proposal, commit_state);
  const original = normalizeRuntime(runtime);
  if (!gate.allow) return {outcome: "BLOCK", reason: gate.reason, runtime: original, receipts: [], physical_status: "NOT_EXECUTED"};

  const compiled = proposal.patches.map(p => compilePatch(bindings, original, p));
  const blocked = compiled.find(x => x.status !== "GROUNDED");
  if (blocked) {
    return {outcome: "BLOCK", reason: blocked.reason, runtime: original, receipts: [], compiled, physical_status: "NOT_EXECUTED"};
  }

  let next = original;
  const receipts = [];
  for (const item of compiled) {
    const ack = transport.write(item.command);
    const observed = transport.read(item.command);
    next = reconcileObservation(next, item, observed);
    const d = next.devices[deviceKey(item.patch.target)];
    receipts.push({
      action_name: item.action_name,
      command: clone(item.command),
      ack: clone(ack),
      observed: clone(observed),
      status: d.physical.status
    });
  }

  return {
    outcome: "EXECUTE",
    reason: "committed_and_observed",
    runtime: next,
    receipts,
    compiled,
    physical_status: aggregateStatus(receipts)
  };
}

module.exports = {
  loadBindings,
  compilePatch,
  commitGate,
  InMemoryThingTransport,
  executeSemanticTurn,
  reconcileObservation
};
