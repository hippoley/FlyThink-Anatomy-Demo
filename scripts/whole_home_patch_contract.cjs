"use strict";

/**
 * Whole-home incremental patch contract.
 *
 * The semantic model proposes a write-set. The runtime applies only that
 * write-set and proves that every untouched device/slot remains byte-for-byte
 * equivalent to the pre-turn state.
 *
 * Device state, task state, pending actions and execution history are separate
 * namespaces. CANCEL_PENDING must never erase persistent device state.
 */

const PATCH_OPS = Object.freeze([
  "ADD_DEVICE",
  "PATCH_SLOT",
  "CLOSE_DEVICE",
  "REMOVE_DEVICE",
  "REPLACE_TARGET",
  "CANCEL_PENDING",
  "UNDO_EXECUTED",
  "PROTECT"
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deviceKey(target) {
  if (!target || !target.area || !target.entity) throw new Error("target_requires_area_and_entity");
  return [target.area, target.entity, target.instance || "default"].join("::");
}

function slotKey(target, slot) {
  return deviceKey(target) + "::" + slot;
}

function normalizeRuntime(runtime = {}) {
  return {
    devices: clone(runtime.devices || {}),
    tasks: clone(runtime.tasks || {}),
    pending: clone(runtime.pending || {}),
    executionLedger: clone(runtime.executionLedger || []),
    protectedInvariants: clone(runtime.protectedInvariants || {}),
    revisions: clone(runtime.revisions || [])
  };
}

function activeDevice(runtime, target) {
  return runtime.devices[deviceKey(target)] || null;
}

function ensureDevice(runtime, target) {
  const key = deviceKey(target);
  if (!runtime.devices[key]) {
    runtime.devices[key] = {
      key,
      area: target.area,
      entity: target.entity,
      instance: target.instance || "default",
      status: "mounted",
      slots: {}
    };
  }
  return runtime.devices[key];
}

function assertNotProtected(runtime, target, slot) {
  const exact = runtime.protectedInvariants[slotKey(target, slot)];
  const whole = runtime.protectedInvariants[deviceKey(target) + "::*"];
  if (exact || whole) throw new Error("protected_invariant_write:" + (slot || "*"));
}

function writeSlot(runtime, target, slot, value) {
  if (!slot) throw new Error("patch_requires_slot");
  assertNotProtected(runtime, target, slot);
  const device = ensureDevice(runtime, target);
  const before = Object.prototype.hasOwnProperty.call(device.slots, slot) ? clone(device.slots[slot]) : undefined;
  device.slots[slot] = clone(value);
  return {path: slotKey(target, slot), before, after: clone(value)};
}

function removeDevice(runtime, target) {
  assertNotProtected(runtime, target, "*");
  const key = deviceKey(target);
  const before = clone(runtime.devices[key]);
  delete runtime.devices[key];
  return {path: key, before, after: undefined};
}

function closeDevice(runtime, patch) {
  // CLOSE is a physical state mutation, not removal from the whole-home tree.
  return writeSlot(runtime, patch.target, patch.slot || "power", patch.value === undefined ? "OFF" : patch.value);
}

function cancelPending(runtime, patch) {
  const id = patch.pending_id || patch.task_id;
  if (!id) throw new Error("cancel_pending_requires_id");
  const before = clone(runtime.pending[id]);
  if (runtime.pending[id]) runtime.pending[id].status = "cancelled";
  return {path: "pending::" + id, before, after: clone(runtime.pending[id])};
}

function undoExecuted(runtime, patch) {
  const id = patch.execution_id;
  if (!id) throw new Error("undo_requires_execution_id");
  const prior = runtime.executionLedger.find(x => x.id === id);
  if (!prior) throw new Error("undo_execution_not_found");
  if (!patch.compensation) throw new Error("undo_requires_explicit_compensation");
  const nested = applyPatch(runtime, patch.compensation, {skipInvariantCheck: true});
  runtime.executionLedger.push({
    id: "undo:" + id + ":" + runtime.executionLedger.length,
    kind: "compensation",
    compensates: id,
    patch: clone(patch.compensation)
  });
  return {path: "executionLedger::" + id, before: clone(prior), after: {compensated: true}, nested};
}

function replaceTarget(runtime, patch) {
  if (!patch.from || !patch.to) throw new Error("replace_requires_from_and_to");
  const fromKey = deviceKey(patch.from);
  const before = clone(runtime.devices[fromKey]);
  if (patch.remove_old === true) removeDevice(runtime, patch.from);
  const target = ensureDevice(runtime, patch.to);
  if (patch.slots) {
    for (const [slot, value] of Object.entries(patch.slots)) writeSlot(runtime, patch.to, slot, value);
  }
  return {path: "replace::" + fromKey + "->" + deviceKey(patch.to), before, after: clone(target)};
}

function protect(runtime, patch) {
  if (!patch.target) throw new Error("protect_requires_target");
  const slot = patch.slot || "*";
  const key = slotKey(patch.target, slot);
  runtime.protectedInvariants[key] = {
    turn_id: patch.turn_id || null,
    reason: patch.reason || "explicit_keep_unchanged"
  };
  return {path: "protected::" + key, before: undefined, after: clone(runtime.protectedInvariants[key])};
}

function diffLeaves(before, after, prefix = "") {
  const out = [];
  if (JSON.stringify(before) === JSON.stringify(after)) return out;
  const bothObjects = before && after && typeof before === "object" && typeof after === "object" &&
    !Array.isArray(before) && !Array.isArray(after);
  if (!bothObjects) return [prefix || "$"];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const next = prefix ? prefix + "::" + key : key;
    out.push(...diffLeaves(before[key], after[key], next));
  }
  return out;
}

function allowedDevicePaths(patch) {
  const allowed = new Set();
  const addSlots = (target, slots) => {
    if (!target) return;
    if (!slots || !Object.keys(slots).length) allowed.add(deviceKey(target));
    for (const slot of Object.keys(slots || {})) allowed.add(slotKey(target, slot));
  };
  switch (patch.op) {
    case "ADD_DEVICE": addSlots(patch.target, patch.slots || {}); break;
    case "PATCH_SLOT": allowed.add(slotKey(patch.target, patch.slot)); break;
    case "CLOSE_DEVICE": allowed.add(slotKey(patch.target, patch.slot || "power")); break;
    case "REMOVE_DEVICE": allowed.add(deviceKey(patch.target)); break;
    case "REPLACE_TARGET":
      if (patch.remove_old === true) allowed.add(deviceKey(patch.from));
      addSlots(patch.to, patch.slots || {});
      break;
    case "UNDO_EXECUTED":
      for (const x of allowedDevicePaths(patch.compensation || {})) allowed.add(x);
      break;
  }
  return allowed;
}

function pathAllowed(path, allowed) {
  for (const prefix of allowed) {
    if (path === prefix || path.startsWith(prefix + "::") || prefix.startsWith(path + "::")) return true;
  }
  return false;
}

function assertUntouchedStatePreserved(before, after, patch) {
  const changed = diffLeaves(before.devices || {}, after.devices || {});
  const allowed = allowedDevicePaths(patch);
  const illegal = changed.filter(path => !pathAllowed(path, allowed));
  if (illegal.length) {
    const error = new Error("untouched_state_mutation:" + illegal.join(","));
    error.illegal_paths = illegal;
    throw error;
  }
  return {ok: true, changed_paths: changed, allowed_paths: [...allowed]};
}

function applyPatch(inputRuntime, patch, options = {}) {
  if (!patch || !PATCH_OPS.includes(patch.op)) throw new Error("unsupported_patch_op");
  const runtime = normalizeRuntime(inputRuntime);
  const before = normalizeRuntime(runtime);
  let receipt;

  switch (patch.op) {
    case "ADD_DEVICE": {
      const device = ensureDevice(runtime, patch.target);
      for (const [slot, value] of Object.entries(patch.slots || {})) writeSlot(runtime, patch.target, slot, value);
      receipt = {path: deviceKey(patch.target), before: activeDevice(before, patch.target), after: clone(device)};
      break;
    }
    case "PATCH_SLOT": receipt = writeSlot(runtime, patch.target, patch.slot, patch.value); break;
    case "CLOSE_DEVICE": receipt = closeDevice(runtime, patch); break;
    case "REMOVE_DEVICE": receipt = removeDevice(runtime, patch.target); break;
    case "REPLACE_TARGET": receipt = replaceTarget(runtime, patch); break;
    case "CANCEL_PENDING": receipt = cancelPending(runtime, patch); break;
    case "UNDO_EXECUTED": receipt = undoExecuted(runtime, patch); break;
    case "PROTECT": receipt = protect(runtime, patch); break;
  }

  if (!options.skipInvariantCheck) assertUntouchedStatePreserved(before, runtime, patch);
  runtime.revisions.push({op: patch.op, turn_id: patch.turn_id || null, receipt: clone(receipt)});
  return {runtime, receipt, invariant: assertUntouchedStatePreserved(before, runtime, patch)};
}

function applyTurn(inputRuntime, patches) {
  let runtime = normalizeRuntime(inputRuntime);
  const receipts = [];
  for (const patch of patches || []) {
    const result = applyPatch(runtime, patch);
    runtime = result.runtime;
    receipts.push({patch: clone(patch), receipt: result.receipt, invariant: result.invariant});
  }
  return {runtime, receipts};
}

module.exports = {
  PATCH_OPS,
  deviceKey,
  normalizeRuntime,
  diffLeaves,
  assertUntouchedStatePreserved,
  applyPatch,
  applyTurn
};
