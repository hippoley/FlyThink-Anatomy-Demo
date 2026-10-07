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
 let calls=0;
 let out=await executeAtomicPhysicalSet(initial,patches,{execute(){calls++;}});
 assert(!out.ok);assert.equal(out.reason,"physical_capability_not_declared:atomic_multi_target_set");
 assert.equal(calls,0);assert.deepStrictEqual(out.runtime,initial);assert.equal(out.receipts.length,0);

 const spoofed={executeAtomicBatch(){throw new Error("must_not_run");}};
 out=await executeAtomicPhysicalSet(initial,patches,spoofed);
 assert(!out.ok);assert.equal(out.reason,"physical_capability_not_declared:atomic_multi_target_set");

 const noReadback={capabilities(){return ["atomic_multi_target_set"];},executeAtomicBatch(){throw new Error("must_not_run");}};
 out=await executeAtomicPhysicalSet(initial,patches,noReadback);
 assert(!out.ok);assert.equal(out.reason,"physical_capability_not_declared:readback");

 const lying={capabilities(){return ["atomic_multi_target_set","readback"];}};
 out=await executeAtomicPhysicalSet(initial,patches,lying);
 assert(!out.ok);assert.equal(out.reason,"physical_atomic_batch_missing_implementation");

 const rejecting={capabilities(){return ["atomic_multi_target_set","readback"];},executeAtomicBatch(){return [
   {id:"b:1",status:"applied",observation:{target:L,exists:true,slots:{power:"ON",temperature:22}}},
   {id:"b:2",status:"rejected",observation:{target:B,exists:true,slots:{power:"ON",temperature:25}}}
 ];}};
 out=await executeAtomicPhysicalSet(initial,patches,rejecting);
 assert(!out.ok);assert.equal(out.reason,"physical_atomic_batch_not_committed");
 assert.deepStrictEqual(out.runtime,initial);assert.equal(out.receipts.length,0);

 const wrongTargets={capabilities(){return ["atomic_multi_target_set","readback"];},executeAtomicBatch(){return [
   {id:"w:1",status:"applied",observation:{target:B,exists:true,slots:{power:"ON",temperature:22}}},
   {id:"w:2",status:"applied",observation:{target:L,exists:true,slots:{power:"ON",temperature:22}}}
 ];}};
 out=await executeAtomicPhysicalSet(initial,patches,wrongTargets);
 assert(!out.ok);assert.equal(out.reason,"physical_atomic_batch_receipt_target_mismatch:0");
 assert.deepStrictEqual(out.runtime,initial);assert.equal(out.receipts.length,0);

 const atomic={capabilities(){return ["atomic_multi_target_set","readback"];},executeAtomicBatch(){return [
   {id:"a:1",status:"applied",observation:{target:L,exists:true,slots:{power:"ON",temperature:22}}},
   {id:"a:2",status:"applied",observation:{target:B,exists:true,slots:{power:"ON",temperature:22}}}
 ];}};
 out=await executeAtomicPhysicalSet(initial,patches,atomic,{turn_id:"set-1"});
 assert(out.ok);assert.equal(out.receipts.length,2);
 assert(out.receipts.every(x=>x.atomic_batch));
 assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
 assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,22);
 assert.equal(out.runtime.executionLedger.length,2);
 console.log(JSON.stringify({
   physical_atomic_set_boundary:"PASS",
   sequential_fallback:0,
   undeclared_atomic_execution:0,
   unverified_readback_commit:0,
   partial_runtime_commit:0,
   wrong_target_readback_commit:0
 }));
})().catch(e=>{console.error(e);process.exit(1);});
