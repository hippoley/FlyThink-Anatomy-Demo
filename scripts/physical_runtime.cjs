"use strict";

const {deviceKey, normalizeRuntime, expandSetPatch, applyPatch} = require("./whole_home_patch_contract.cjs");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function activeDevice(runtime, target) {
  return (runtime.devices || {})[deviceKey(target)] || null;
}

function materializePatch(runtime, patch) {
  if (!patch) throw new Error("physical_patch_required");
  if (patch.op === "PATCH_RELATIVE") {
    const device = activeDevice(runtime, patch.target);
    if (!device || !Object.prototype.hasOwnProperty.call(device.slots || {}, patch.slot)) {
      throw new Error("relative_patch_requires_existing_value");
    }
    const before = device.slots[patch.slot];
    if (typeof before !== "number" || typeof patch.delta !== "number") {
      throw new Error("relative_patch_requires_numeric_values");
    }
    return {...clone(patch), op: "PATCH_SLOT", value: before + patch.delta, source_op: "PATCH_RELATIVE"};
  }
  if (patch.op === "CLOSE_DEVICE") {
    return {
      ...clone(patch),
      op: "PATCH_SLOT",
      slot: patch.slot || "power",
      value: patch.value === undefined ? "OFF" : patch.value,
      source_op: "CLOSE_DEVICE"
    };
  }
  return clone(patch);
}

class MockThingDriver {
  constructor(initialRuntime = {}, options = {}) {
    this.world = normalizeRuntime(initialRuntime);
    this.options = options;
    this.commands = [];
  }

  execute(patch) {
    const before = normalizeRuntime(this.world);
    const effective = clone(patch);
    const commandId = "mock:" + (this.commands.length + 1);

    if (this.options.reject && this.options.reject(effective, before)) {
      const observation = this.observePatch(effective);
      const receipt = {id: commandId, status: "rejected", patch: effective, observation};
      this.commands.push(receipt);
      return receipt;
    }

    if (this.options.transform) {
      const transformed = this.options.transform(effective, before);
      if (transformed) Object.assign(effective, transformed);
    }

    const applied = applyPatch(this.world, effective);
    this.world = applied.runtime;
    const observation = this.observePatch(effective);
    const receipt = {id: commandId, status: "applied", patch: effective, observation};
    this.commands.push(receipt);
    return receipt;
  }

  observePatch(patch) {
    if (patch.op === "REMOVE_DEVICE") {
      return {target: clone(patch.target), exists: false, slots: null};
    }
    if (patch.op === "REPLACE_TARGET") {
      const target = patch.to;
      const device = activeDevice(this.world, target);
      return {target: clone(target), exists: !!device, slots: clone(device ? device.slots : {})};
    }
    const target = patch.target;
    if (!target) return {target: null, exists: true, slots: {}};
    const device = activeDevice(this.world, target);
    return {target: clone(target), exists: !!device, slots: clone(device ? device.slots : {})};
  }
}

function reconcileObservation(runtime, observation, turnId = null) {
  let next = normalizeRuntime(runtime);
  if (!observation || !observation.target) return next;
  const target = observation.target;
  const key = deviceKey(target);

  if (observation.exists === false) {
    if (next.devices[key]) {
      next = applyPatch(next, {op: "REMOVE_DEVICE", target, turn_id: turnId}).runtime;
    }
    return next;
  }

  const existing = next.devices[key];
  if (!existing) {
    next = applyPatch(next, {
      op: "ADD_DEVICE",
      target,
      slots: clone(observation.slots || {}),
      turn_id: turnId
    }).runtime;
    return next;
  }

  for (const [slot, value] of Object.entries(observation.slots || {})) {
    if (JSON.stringify(existing.slots && existing.slots[slot]) === JSON.stringify(value)) continue;
    next = applyPatch(next, {op: "PATCH_SLOT", target, slot, value: clone(value), turn_id: turnId}).runtime;
  }
  return next;
}

function executePhysicalTurn(inputRuntime, patches, driver, options = {}) {
  let runtime = normalizeRuntime(inputRuntime);
  const receipts = [];
  for (const proposed of patches || []) {
    for (const expanded of expandSetPatch(proposed)) {
      if (["CANCEL_PENDING", "PROTECT"].includes(expanded.op)) {
        const local = applyPatch(runtime, expanded);
        runtime = local.runtime;
        receipts.push({patch: clone(expanded), local_only: true, receipt: local.receipt});
        continue;
      }

      const physicalPatch = materializePatch(runtime, expanded);
      const command = driver.execute(physicalPatch);
      runtime = reconcileObservation(runtime, command.observation, expanded.turn_id || options.turn_id || null);
      receipts.push({
        patch: clone(expanded),
        physical_patch: physicalPatch,
        command_id: command.id,
        status: command.status,
        observation: clone(command.observation)
      });
    }
  }
  return {runtime, receipts};
}

module.exports = {
  MockThingDriver,
  materializePatch,
  reconcileObservation,
  executePhysicalTurn
};
