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
valid=plan(registry,authorized,"temperature",22,turn_id="turn-42")
assert valid["ok"] and len(valid["patches"])==2
assert valid["authorization"]["patch_digest"]
assert valid["authorization"]["registry_digest"]
assert valid["authorization"]["authorization_id"]
assert valid["authorization"]["turn_id"]=="turn-42"
assert not plan(registry,authorized,"temperature",31)["ok"]
assert not plan(registry,["客厅::空调::default","书房::空调::default"],"temperature",22)["ok"]

node=r'''
const assert=require("assert");
const payload=JSON.parse(process.argv[1]);
const registryDigest=payload.authorization.registry_digest;
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
const before=JSON.parse(JSON.stringify(r));
const untouched=JSON.parse(JSON.stringify(r.devices["客厅::灯::default"]));
const ledger=()=>{const s=new Set();return {has:id=>s.has(id),add:id=>{if(s.has(id))return false;s.add(id);return true;}}};\nconst consumed=ledger();

let out=atomicApplyAuthorizedPlan(r,payload,registryDigest,consumed);
assert(out.ok);
assert(consumed.has(payload.authorization.authorization_id));
assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,22);
assert.equal(out.runtime.devices["次卧::空调::default"].slots.temperature,26);
assert.deepStrictEqual(out.runtime.devices["客厅::灯::default"],untouched);

// Same authorization is single-use even if patch and registry are unchanged.
const committed=out.runtime;
out=atomicApplyAuthorizedPlan(committed,payload,registryDigest,consumed);
assert(!out.ok);assert.equal(out.reason,"planner_authorization_replayed");
assert.deepStrictEqual(out.runtime,committed);assert.equal(out.receipts.length,0);

// A valid mounted/capable third device cannot be injected after planning.
const tampered=JSON.parse(JSON.stringify(payload));
tampered.patches[1].target="次卧::空调::default";
out=atomicApplyAuthorizedPlan(before,tampered,registryDigest,ledger());
assert(!out.ok);assert.equal(out.reason,"planner_authorization_digest_mismatch");
assert.deepStrictEqual(out.runtime,before);assert.equal(out.receipts.length,0);

for(const field of ["value","model_id","capability"]){
 const x=JSON.parse(JSON.stringify(payload));
 x.patches[0][field]=field==="value"?23:"FORGED";
 out=atomicApplyAuthorizedPlan(before,x,registryDigest,ledger());
 assert(!out.ok);assert.equal(out.reason,"planner_authorization_digest_mismatch");
 assert.equal(out.receipts.length,0);
}

// Authorization cannot survive registry rebind/re-provision.
out=atomicApplyAuthorizedPlan(before,payload,"registry-after-rebind",ledger());
assert(!out.ok);assert.equal(out.reason,"planner_authorization_stale_registry");
assert.deepStrictEqual(out.runtime,before);assert.equal(out.receipts.length,0);

console.log(JSON.stringify({
 planner_bound_authorization:"PASS",
 mounted_wrong_device_injection:0,
 post_planner_patch_tamper:0,
 stale_registry_authorization:0,
 authorization_replay:0,
 unauthorized_receipt:0,
 untouched_state_violation:0
}));
'''
p=subprocess.run(["node","-e",node,json.dumps(valid,ensure_ascii=False)],text=True,capture_output=True)
if p.returncode: raise SystemExit(p.stderr or p.stdout)
print(p.stdout.strip())
