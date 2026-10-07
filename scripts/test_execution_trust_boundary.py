#!/usr/bin/env python3
"""System proof for semantic -> planner -> atomic execution trust boundary."""
import json, subprocess
from device_registry import DeviceRegistry, DeviceBinding
from authorized_patch_planner import plan

registry=DeviceRegistry([
 DeviceBinding("客厅","空调","default","AWGD-ZA01"),
 DeviceBinding("主卧","空调","default","AWGD-ZA01"),
 DeviceBinding("客厅","灯","default","LIGHT_GROUP"),
])
authorized=["客厅::空调::default","主卧::空调::default"]

valid=plan(registry,authorized,"temperature",22)
assert valid["ok"] and len(valid["patches"])==2
invalid_range=plan(registry,authorized,"temperature",31)
assert not invalid_range["ok"] and invalid_range["patches"]==[]
unmounted=plan(registry,["客厅::空调::default","书房::空调::default"],"temperature",22)
assert not unmounted["ok"] and unmounted["patches"]==[]

payload={"authorized":authorized,"planner_patches":valid["patches"]}
node=r'''
const assert=require("assert");
const payload=JSON.parse(process.argv[1]);
const {normalizeRuntime,applyTurn}=require("./scripts/whole_home_patch_contract.cjs");
const {atomicApplyAuthorizedTurn}=require("./scripts/atomic_authorized_commit.cjs");
const parse=k=>{const [area,entity,instance]=k.split("::");return {area,entity,instance};};
const semantic=payload.planner_patches.map(p=>({op:"PATCH_SLOT",target:parse(p.target),slot:p.slot,value:p.value}));
let r=normalizeRuntime();
r=applyTurn(r,[
 {op:"ADD_DEVICE",target:parse("客厅::空调::default"),slots:{power:"ON",temperature:24}},
 {op:"ADD_DEVICE",target:parse("主卧::空调::default"),slots:{power:"ON",temperature:25}},
 {op:"ADD_DEVICE",target:parse("客厅::灯::default"),slots:{power:"OFF"}}
]).runtime;
const untouched=JSON.parse(JSON.stringify(r.devices["客厅::灯::default"]));

// Planner-approved SET crosses the commit boundary atomically.
let out=atomicApplyAuthorizedTurn(r,semantic,payload.authorized);
assert(out.ok);
assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,22);
assert.deepStrictEqual(out.runtime.devices["客厅::灯::default"],untouched);

// PROTECT is rechecked at commit time: entire SET rolls back.
const protectedR=applyTurn(r,[{op:"PROTECT",target:parse("主卧::空调::default"),slot:"temperature"}]).runtime;
out=atomicApplyAuthorizedTurn(protectedR,semantic,payload.authorized);
assert(!out.ok);
assert.deepStrictEqual(out.runtime,protectedR);
assert.equal(out.receipts.length,0);

// Tampered post-planner target cannot cross the allowlist.
const tampered=[{op:"PATCH_SLOT",target:parse("书房::空调::default"),slot:"temperature",value:22}];
out=atomicApplyAuthorizedTurn(r,tampered,payload.authorized);
assert(!out.ok);
assert(out.reason.startsWith("target_not_authorized:"));
assert.deepStrictEqual(out.runtime,r);
assert.equal(out.receipts.length,0);

// Even a forged allowlist cannot create an unmounted runtime device.
out=atomicApplyAuthorizedTurn(r,tampered,[...payload.authorized,"书房::空调::default"]);
assert(!out.ok);
assert(out.reason.startsWith("authorized_target_not_mounted:"));
assert.deepStrictEqual(out.runtime,r);
assert.equal(out.receipts.length,0);

console.log(JSON.stringify({
 semantic_to_execution_trust_boundary:"PASS",
 partial_set_commit:0,
 wrong_device_execution:0,
 untouched_state_violation:0,
 unauthorized_receipt:0
}));
'''
p=subprocess.run(["node","-e",node,json.dumps(payload,ensure_ascii=False)],text=True,capture_output=True)
if p.returncode:
 raise SystemExit(p.stderr or p.stdout)
print(p.stdout.strip())
