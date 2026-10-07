"use strict";
const assert=require("assert");
const {normalizeRuntime,applyTurn}=require("./whole_home_patch_contract.cjs");
const {executeAtomicPhysicalSet}=require("./atomic_physical_set.cjs");
const L={area:"客厅",entity:"空调",instance:"default"},B={area:"主卧",entity:"空调",instance:"default"};
let initial=normalizeRuntime();
initial=applyTurn(initial,[
 {op:"ADD_DEVICE",target:L,slots:{power:"ON",temperature:24}},
 {op:"ADD_DEVICE",target:B,slots:{power:"ON",temperature:25}}
]).runtime;
const patches=[
 {op:"PATCH_SLOT",target:L,slot:"temperature",value:22},
 {op:"PATCH_SLOT",target:B,slot:"temperature",value:22}
];

(async()=>{
 // Sequential-only drivers are not allowed to masquerade as atomic physical SET.
 let calls=0;
 let out=await executeAtomicPhysicalSet(initial,patches,{execute(){calls++;}});
 assert(!out.ok);assert.equal(out.reason,"physical_atomic_batch_unsupported");
 assert.equal(calls,0);assert.deepStrictEqual(out.runtime,initial);assert.equal(out.receipts.length,0);

 // Batch rejection returns no committed runtime/receipts.
 const rejecting={executeAtomicBatch(){return [
   {id:"b:1",status:"applied",observation:{target:L,exists:true,slots:{power:"ON",temperature:22}}},
   {id:"b:2",status:"rejected",observation:{target:B,exists:true,slots:{power:"ON",temperature:25}}}
 ];}};
 out=await executeAtomicPhysicalSet(initial,patches,rejecting);
 assert(!out.ok);assert.equal(out.reason,"physical_atomic_batch_not_committed");
 assert.deepStrictEqual(out.runtime,initial);assert.equal(out.receipts.length,0);

 // A driver that can guarantee batch commit yields reconciled readback for all targets.
 const atomic={executeAtomicBatch(){return [
   {id:"a:1",status:"applied",observation:{target:L,exists:true,slots:{power:"ON",temperature:22}}},
   {id:"a:2",status:"applied",observation:{target:B,exists:true,slots:{power:"ON",temperature:22}}}
 ];}};
 out=await executeAtomicPhysicalSet(initial,patches,atomic,{turn_id:"set-1"});
 assert(out.ok);assert.equal(out.receipts.length,2);
 assert(out.receipts.every(x=>x.atomic_batch));
 assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
 assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,22);
 assert.equal(out.runtime.executionLedger.length,2);
 console.log(JSON.stringify({physical_atomic_set_boundary:"PASS",sequential_fallback:0,partial_runtime_commit:0}));
})().catch(e=>{console.error(e);process.exit(1);});
