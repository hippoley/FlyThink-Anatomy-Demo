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

function valueAllowed(contract, value) {
  if (!contract || !contract.kind) return false;
  if (contract.kind === "bool") return typeof value === "boolean";
  if (contract.kind === "range") {
    return Number.isFinite(value)
      && (contract.minimum == null || value >= contract.minimum)
      && (contract.maximum == null || value <= contract.maximum);
  }
  if (contract.kind === "enum") return Array.isArray(contract.allowed) && contract.allowed.some(v => JSON.stringify(v) === JSON.stringify(value));
  return false;
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
    if (role === "exterior_window" && patch.slot === "opening" && Number.isFinite(patch.value)) {
      return {ok: true, role, kind: "property", code: "motorTargetPosition", value: patch.value};
    }
    if (role === "insect_screen" && patch.slot === "opening") {
      if (patch.value === 0) return {ok: true, role, kind: "verb", verb: "close"};
      if (patch.value === 100) return {ok: true, role, kind: "verb", verb: "open"};
      return {ok: false, reason: "runtime_binding_has_no_position_setpoint"};
    }
  }

  return {ok: false, reason: "unsupported_semantic_patch_for_physical_binding"};
}

function absolutizeRelative(runtime, patch) {
  if (!patch || patch.op !== "PATCH_RELATIVE") return {ok: true, patch: clone(patch)};
  if (!patch.target || !patch.slot || !Number.isFinite(patch.delta)) {
    return {ok: false, reason: "relative_patch_missing_target_slot_or_delta"};
  }
  const d = (runtime.devices || {})[deviceKey(patch.target)];
  const current = d && d.slots && d.slots[patch.slot];
  if (!Number.isFinite(current)) {
    return {ok: false, reason: "relative_patch_requires_observed_state"};
  }
  return {
    ok: true,
    patch: {...clone(patch), op:"PATCH_SLOT", value: current + patch.delta},
    source_op:"PATCH_RELATIVE",
    observed_base: current
  };
}

function semanticExpectation(req) {
  if (!req || !req.ok) return null;
  if (req.kind === "verb" && req.role === "exterior_window") {
    if (req.verb === "close") return {slot:"opening", value:0};
    if (req.verb === "open") return {slot:"opening", value:100};
  }
  if (req.kind === "property") {
    if (req.code === "power" && typeof req.value === "boolean") return {slot:"power", value:req.value ? "ON" : "OFF"};
    if (req.code === "brightness" && Number.isFinite(req.value)) return {slot:"brightness", value:req.value};
    if (req.code === "colorTemperature" && Number.isFinite(req.value)) return {slot:"color_temperature", value:req.value};
    if (req.code === "motorTargetPosition" && Number.isFinite(req.value)) return {slot:"opening", value:req.value};
  }
  return null;
}

function feedbackFor(bindings, action, expectation) {
  if (!expectation || !bindings.feedback) return null;
  const candidates = Object.entries(bindings.feedback)
    .map(([name, feedback]) => ({name, ...feedback}))
    .filter(x =>
      x.entity_id === action.entity_id
      && x.semantic_role === action.semantic_role
      && x.semantic_slot === expectation.slot
    );
  if (candidates.length !== 1) return null;
  const f = candidates[0];
  return {...clone(f), capability_key: capabilityKey(f)};
}

function boundDevice(runtime, target) {
  const d = (runtime.devices || {})[deviceKey(target)];
  if (!d || !d.physical_binding || !d.physical_binding.entity_id) {
    return {ok: false, reason: "unbound_physical_target"};
  }
  return {ok: true, device: d, binding: d.physical_binding};
}

function compilePatch(bindings, runtime, patch) {
  const sourcePatch = clone(patch);
  const relative = absolutizeRelative(runtime, patch);
  if (!relative.ok) return {status:"BLOCKED", reason:relative.reason, patch:sourcePatch};
  patch = relative.patch;

  const req = requestFromPatch(patch);
  if (!req.ok) return {status: "BLOCKED", reason: req.reason, patch: sourcePatch};

  const bd = boundDevice(runtime, patch.target);
  if (!bd.ok) return {status: "BLOCKED", reason: bd.reason, patch: clone(patch)};

  if (bd.binding.semantic_role && bd.binding.semantic_role !== req.role) {
    return {status: "BLOCKED", reason: "semantic_role_binding_mismatch", patch: clone(patch)};
  }

  const actions = Object.entries(bindings.actions)
    .map(([name, action]) => ({name, ...action}))
    .filter(a => a.entity_id === bd.binding.entity_id && a.semantic_role === req.role);

  let candidates;
  let dynamicValue = false;
  if (req.kind === "verb") {
    candidates = actions.filter(a => a.name.endsWith("_" + req.verb));
  } else {
    const sameProperty = actions.filter(a => a.code === req.code);
    const exact = sameProperty.filter(a => JSON.stringify(a.value) === JSON.stringify(req.value));
    if (exact.length) {
      candidates = exact;
    } else {
      const compatible = sameProperty.filter(a => valueAllowed(a.value_contract, req.value));
      const unique = new Map();
      for (const a of compatible) unique.set(capabilityKey(a), a);
      candidates = [...unique.values()];
      dynamicValue = candidates.length === 1;
      if (!candidates.length && sameProperty.length) {
        return {
          status: "BLOCKED",
          reason: "physical_value_contract_violation",
          patch: clone(patch),
          request: req,
          contracts: sameProperty.map(a => clone(a.value_contract))
        };
      }
    }
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
  const expectation = semanticExpectation(req);
  const feedback = feedbackFor(bindings, a, expectation);
  return {
    status: "GROUNDED",
    patch: sourcePatch,
    effective_patch: clone(patch),
    relative_resolution: relative.source_op ? {
      source_op:relative.source_op,
      observed_base:relative.observed_base,
      absolute_value:patch.value
    } : null,
    expectation,
    feedback,
    action_name: dynamicValue ? a.name + ":dynamic" : a.name,
    command: {
      entity_id: a.entity_id,
      product_model: a.product_model,
      module: a.module,
      interaction: a.interaction,
      code: a.code,
      value: clone(dynamicValue ? req.value : a.value),
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
    if (!this.drop_writes) {
      this.world[command.entity_id][command.capability_key] = clone(command.value);

      if (command.product_model === "CWDS-CA01" && command.module === "motor_1") {
        const currentKey = ["CWDS-CA01","motor_1","property","motorCurrentPosition"].join("|");
        const statusKey = ["CWDS-CA01","motor_1","property","motorStatus"].join("|");
        if (command.code === "motorTargetPosition" && Number.isFinite(command.value)) {
          this.world[command.entity_id][currentKey] = command.value;
          this.world[command.entity_id][statusKey] = 2;
        }
        if (command.code === "motorControl") {
          if (command.value === 0) this.world[command.entity_id][currentKey] = 100;
          if (command.value === 1) this.world[command.entity_id][currentKey] = 0;
          this.world[command.entity_id][statusKey] = 2;
        }
      }
    }
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

function semanticObserved(expectation, observed) {
  if (!expectation) return undefined;
  if (expectation.slot === "power") {
    if (typeof observed !== "boolean") return undefined;
    return observed ? "ON" : "OFF";
  }
  if (["brightness","color_temperature","opening"].includes(expectation.slot)) {
    return Number.isFinite(observed) ? observed : undefined;
  }
  return observed;
}

function reconcileObservation(runtime, compiled, observed) {
  const next = normalizeRuntime(runtime);
  const before = normalizeRuntime(runtime);
  const patch = compiled.patch;
  const key = deviceKey(patch.target);
  const d = next.devices[key];
  if (!d) throw new Error("reconcile_target_missing:" + key);

  const observationDescriptor = compiled.feedback || compiled.command;
  const observationIsState = !!compiled.feedback || isStateBearing(compiled.command);
  const observedSemantic = observationIsState
    ? semanticObserved(compiled.expectation, observed)
    : undefined;

  d.physical = d.physical || {};
  d.physical.desired = {
    semantic: clone(compiled.expectation),
    entity_id: compiled.command.entity_id,
    capability_key: compiled.command.capability_key,
    value: clone(compiled.command.value)
  };
  d.physical.observed = {
    entity_id: observationDescriptor.entity_id,
    capability_key: observationDescriptor.capability_key,
    value: clone(observed),
    semantic_value: clone(observedSemantic)
  };

  if (!observationIsState || observedSemantic === undefined || !compiled.expectation) {
    d.physical.status = "COMMAND_CONFIRMED_OBSERVATION_PENDING";
  } else {
    const equal = JSON.stringify(observedSemantic) === JSON.stringify(compiled.expectation.value);
    d.physical.status = equal ? "STATE_CONFIRMED" : "MISMATCH";
    d.slots[compiled.expectation.slot] = clone(observedSemantic);
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
    feedback: clone(compiled.feedback),
    expected: clone(compiled.expectation),
    observed: clone(observed),
    observed_semantic: clone(observedSemantic),
    status: d.physical.status
  });
  return next;
}

function aggregateStatus(receipts) {
  if (receipts.some(r => r.status === "OBSERVATION_FAILED")) return "OBSERVATION_FAILED";
  if (receipts.some(r => r.status === "MISMATCH")) return "MISMATCH";
  if (receipts.some(r => r.status === "COMMAND_CONFIRMED_OBSERVATION_PENDING")) return "OBSERVATION_PENDING";
  return "CONFIRMED";
}

function reconcileObservationFailure(runtime, compiled, error) {
  const next = normalizeRuntime(runtime);
  const before = normalizeRuntime(runtime);
  const patch = compiled.patch;
  const key = deviceKey(patch.target);
  const d = next.devices[key];
  if (!d) throw new Error("reconcile_target_missing:" + key);

  d.physical = d.physical || {};
  d.physical.desired = {
    semantic: clone(compiled.expectation),
    entity_id: compiled.command.entity_id,
    capability_key: compiled.command.capability_key,
    value: clone(compiled.command.value)
  };
  d.physical.observed = null;
  d.physical.status = "OBSERVATION_FAILED";
  d.physical.observation_error = String(error && error.message || error);

  const changed = diffLeaves(before.devices || {}, next.devices || {});
  const illegal = changed.filter(p => !(p === key || p.startsWith(key + "::")));
  if (illegal.length) throw new Error("reconcile_untouched_state_mutation:" + illegal.join(","));

  next.executionLedger.push({
    id: "physical:" + (next.executionLedger.length + 1),
    kind: "physical_observation_failure",
    action_name: compiled.action_name,
    target: clone(patch.target),
    command: clone(compiled.command),
    feedback: clone(compiled.feedback),
    expected: clone(compiled.expectation),
    status: "OBSERVATION_FAILED",
    error: d.physical.observation_error
  });
  return next;
}


async function executeSemanticTurnAsync({runtime, proposal, commit_state, transport, bindings}) {
  const gate = commitGate(proposal, commit_state);
  const original = normalizeRuntime(runtime);
  if (!gate.allow) {
    return {
      outcome:"BLOCK",
      reason:gate.reason,
      runtime:original,
      receipts:[],
      physical_status:"NOT_EXECUTED"
    };
  }

  const compiled = proposal.patches.map(p => compilePatch(bindings, original, p));
  const blocked = compiled.find(x => x.status !== "GROUNDED");
  if (blocked) {
    return {
      outcome:"BLOCK",
      reason:blocked.reason,
      runtime:original,
      receipts:[],
      compiled,
      physical_status:"NOT_EXECUTED"
    };
  }

  let next=original;
  const receipts=[];
  for (const item of compiled) {
    let ack;
    try {
      ack=await transport.write(item.command);
    } catch (error) {
      return {
        outcome:"BLOCK",
        reason:"transport_write_blocked:" + String(error && error.message || error),
        runtime:next,
        receipts,
        compiled,
        physical_status:"NOT_EXECUTED"
      };
    }

    try {
      const observed=await transport.read(
        item.feedback || item.command,
        {expectation:item.expectation,command:item.command}
      );
      next=reconcileObservation(next,item,observed);
      const d=next.devices[deviceKey(item.patch.target)];
      receipts.push({
        action_name:item.action_name,
        command:clone(item.command),
        feedback:clone(item.feedback),
        expectation:clone(item.expectation),
        relative_resolution:clone(item.relative_resolution),
        ack:clone(ack),
        observed:clone(observed),
        status:d.physical.status
      });
    } catch (error) {
      next=reconcileObservationFailure(next,item,error);
      receipts.push({
        action_name:item.action_name,
        command:clone(item.command),
        feedback:clone(item.feedback),
        expectation:clone(item.expectation),
        relative_resolution:clone(item.relative_resolution),
        ack:clone(ack),
        observed:null,
        status:"OBSERVATION_FAILED",
        error:String(error && error.message || error)
      });
    }
  }

  return {
    outcome:"EXECUTE",
    reason:"committed_and_observation_attempted",
    runtime:next,
    receipts,
    compiled,
    physical_status:aggregateStatus(receipts)
  };
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
    const observed = transport.read(item.feedback || item.command);
    next = reconcileObservation(next, item, observed);
    const d = next.devices[deviceKey(item.patch.target)];
    receipts.push({
      action_name: item.action_name,
      command: clone(item.command),
      feedback: clone(item.feedback),
      expectation: clone(item.expectation),
      relative_resolution: clone(item.relative_resolution),
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
  executeSemanticTurnAsync,
  reconcileObservation,
  reconcileObservationFailure,
  valueAllowed,
  absolutizeRelative
};
