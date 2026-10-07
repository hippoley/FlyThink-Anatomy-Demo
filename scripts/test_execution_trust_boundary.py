#!/usr/bin/env python3
"""Cross-language proof for planner-bound semantic execution authorization."""
import json,subprocess
from device_registry import DeviceRegistry,DeviceBinding
from authorized_patch_planner import plan

registry=DeviceRegistry([
 DeviceBinding("客厅","空调","default","AWGD-ZA01"),
 DeviceBinding("主卧","空调","default","AWGD-ZA01"),
 DeviceBinding("次卧","空调","default","AWGD-ZA01"),
 DeviceBinding("客厅","灯","default","LIGHT_GROUP"),
])
authorized=["客厅::空调::default","主卧::空调::default"]
valid=plan(registry,authorized,"temperature",22)
assert valid["ok"] and len(valid["patches"])==2 and valid["authorization"]["patch_digest"]
assert not plan(registry,authorized,"temperature",31)["ok"]
assert not plan(registry,["客厅::空调::default","书房::空调::default"],"temperature",22)["ok"]

node=r'''
const assert=require("assert");
const payload=JSON.parse(process.argv[1]);
const {normalizeRuntime,applyTurn}=require("./scripts/whole_home_patch_contract.cjs");
const {atomicApplyAuthorizedPlan}=require("./scripts/atomic_authorized_commit.cjs");
const parse=k=>{const [area,entity,instance]=k.split("::");return {area,entity,instance};};
let r=normalizeRuntime();
r=applyTurn(r,[
 {op:"ADD_DEVICE",target:parse("客厅::空调::default"),slots:{power:"ON",temperature:24}},
 {op:"ADD_DEVICE",target:parse("主卧::空调::default"),slots:{power:"ON",temperature:25}},
 {op:"ADD_DEVICE",target:parse("次卧::空调::default"),slots:{power:"ON",temperature:26}},
 {op:"ADD_DEVICE",target:parse("客厅::灯::default"),slots:{power:"OFF"}}
]).runtime;
const untouched=JSON.parse(JSON.stringify(r.devices["客厅::灯::default"]));
let out=atomicApplyAuthorizedPlan(r,payload);
assert(out.ok);
assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,22);
assert.equal(out.runtime.devices["次卧::空调::default"].slots.temperature,26);
assert.deepStrictEqual(out.runtime.devices["客厅::灯::default"],untouched);

// A valid mounted/capable third device cannot be injected after planning.
const tampered=JSON.parse(JSON.stringify(payload));
tampered.patches[1].target="次卧::空调::default";
out=atomicApplyAuthorizedPlan(r,tampered);
assert(!out.ok);assert.equal(out.reason,"planner_authorization_digest_mismatch");
assert.deepStrictEqual(out.runtime,r);assert.equal(out.receipts.length,0);

// Value/model/capability tampering is equally bound.
for(const field of ["value","model_id","capability"]){
 const x=JSON.parse(JSON.stringify(payload));
 x.patches[0][field]=field==="value"?23:"FORGED";
 out=atomicApplyAuthorizedPlan(r,x);
 assert(!out.ok);assert.equal(out.reason,"planner_authorization_digest_mismatch");
 assert.equal(out.receipts.length,0);
}
console.log(JSON.stringify({
 planner_bound_authorization:"PASS",
 mounted_wrong_device_injection:0,
 post_planner_patch_tamper:0,
 unauthorized_receipt:0,
 untouched_state_violation:0
}));
'''
p=subprocess.run(["node","-e",node,json.dumps(valid,ensure_ascii=False)],text=True,capture_output=True)
if p.returncode: raise SystemExit(p.stderr or p.stdout)
print(p.stdout.strip())
