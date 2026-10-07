#!/usr/bin/env python3
"""Cross-language proof for planner-bound semantic execution authorization."""
import json
import os
import subprocess
import tempfile
from device_registry import DeviceRegistry, DeviceBinding
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

node=r"""
const assert=require("assert");
const payload=JSON.parse(process.argv[2]);
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
const ledger=()=>{const s=new Map();return {
 status:id=>s.get(id)||"fresh",
 reserve:id=>{if(s.has(id))return false;s.set(id,"reserved");return true;},
 consume:id=>{if(s.get(id)!=="reserved")return false;s.set(id,"consumed");return true;},
 release:id=>{if(s.get(id)!=="reserved")return false;s.delete(id);return true;}
}};

const consumed=ledger();
let out=atomicApplyAuthorizedPlan(r,payload,registryDigest,consumed);
assert(out.ok);
assert.equal(consumed.status(payload.authorization.authorization_id),"consumed");
assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,22);
assert.equal(out.runtime.devices["次卧::空调::default"].slots.temperature,26);
assert.deepStrictEqual(out.runtime.devices["客厅::灯::default"],untouched);

const committed=out.runtime;
out=atomicApplyAuthorizedPlan(committed,payload,registryDigest,consumed);
assert(!out.ok);assert.equal(out.reason,"planner_authorization_replayed");
assert.deepStrictEqual(out.runtime,committed);assert.equal(out.receipts.length,0);

const forged=JSON.parse(JSON.stringify(payload));
forged.authorization.authorization_id="forged-auth-"+Date.now();
forged.authorization.turn_id="forged-turn";
const forgedLedger=ledger();
out=atomicApplyAuthorizedPlan(before,forged,registryDigest,forgedLedger);
const forgedAccepted=out.ok===true;
assert(forgedAccepted,"expected current executor to expose forged-authorization authenticity gap");
assert.equal(forgedLedger.status(forged.authorization.authorization_id),"consumed");

const tampered=JSON.parse(JSON.stringify(payload));
tampered.patches[1].target="次卧::空调::default";
const tamperLedger=ledger();
out=atomicApplyAuthorizedPlan(before,tampered,registryDigest,tamperLedger);
assert(!out.ok);assert.equal(out.reason,"planner_authorization_digest_mismatch");
assert.equal(tamperLedger.status(payload.authorization.authorization_id),"fresh");

const staleLedger=ledger();
out=atomicApplyAuthorizedPlan(before,payload,"registry-after-rebind",staleLedger);
assert(!out.ok);assert.equal(out.reason,"planner_authorization_stale_registry");
assert.equal(staleLedger.status(payload.authorization.authorization_id),"fresh");

const indeterminateLedger={
 state:"fresh",
 reserve(){this.state="reserved";return true;},
 consume(){return false;},
 release(){this.state="fresh";return true;}
};
out=atomicApplyAuthorizedPlan(before,payload,registryDigest,indeterminateLedger);
assert(!out.ok);assert.equal(out.reason,"authorization_commit_indeterminate");
assert.equal(indeterminateLedger.state,"reserved");
assert.deepStrictEqual(out.runtime,before);assert.equal(out.receipts.length,0);

console.log(JSON.stringify({
 planner_bound_authorization:"PASS",
 forged_authorization_currently_accepted:forgedAccepted?1:0,
 mounted_wrong_device_injection:0,
 post_planner_patch_tamper:0,
 stale_registry_authorization:0,
 authorization_replay:0,
 leaked_validation_reservation:0,
 released_indeterminate_authorization:0,
 unauthorized_receipt:0,
 untouched_state_violation:0
}));
"""
with tempfile.NamedTemporaryFile("w",suffix=".cjs",dir=".",delete=False,encoding="utf-8") as script:
    script.write(node)
    script_path=script.name
try:
    p=subprocess.run(["node",script_path,json.dumps(valid,ensure_ascii=False)],text=True,capture_output=True)
finally:
    os.unlink(script_path)
if p.returncode:
    raise SystemExit(p.stderr or p.stdout)
print(p.stdout.strip())
