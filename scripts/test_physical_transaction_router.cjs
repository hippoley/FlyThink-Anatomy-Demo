"use strict";
const assert=require("assert");
const {normalizeRuntime,applyTurn}=require("./whole_home_patch_contract.cjs");
const {executePhysicalTransaction}=require("./physical_transaction_router.cjs");
const {PHYSICAL_CAPABILITIES}=require("./physical_driver_capabilities.cjs");

const t=(area)=>({area,entity:"空调",instance:"default"});
let runtime=normalizeRuntime();
runtime=applyTurn(runtime,[
 {op:"ADD_DEVICE",target:t("客厅"),slots:{temperature:24}},
 {op:"ADD_DEVICE",target:t("主卧"),slots:{temperature:25}}
]).runtime;

(async()=>{
 let sequentialCalls=0;
 const sequentialOnly={
  execute(){sequentialCalls++;throw new Error("must_not_execute_sequentially");}
 };
 const setPatch={op:"PATCH_SLOT",targets:[t("客厅"),t("主卧")],slot:"temperature",value:22,turn_id:"turn-set"};
 let out=await executePhysicalTransaction(runtime,setPatch,sequentialOnly,{},async()=>{sequentialCalls++;});
 assert(!out.ok);
 assert.equal(sequentialCalls,0);
 assert.deepStrictEqual(out.runtime,runtime);
 assert.equal(out.receipts.length,0);

 let batchCalls=0;
 const atomic={
  capabilities:[PHYSICAL_CAPABILITIES.ATOMIC_MULTI_TARGET_SET,PHYSICAL_CAPABILITIES.READBACK],
  executeAtomicBatch(patches){
   batchCalls++;
   assert.equal(patches.length,2);
   return patches.map((p,i)=>({
    id:"batch:"+(i+1),status:"applied",
    observation:{target:p.target,exists:true,slots:{temperature:p.value}}
   }));
  }
 };
 out=await executePhysicalTransaction(runtime,setPatch,atomic,{},async()=>{throw new Error("no sequential fallback");});
 assert(out.ok);
 assert.equal(batchCalls,1);
 assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
 assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,22);

 let singleCalls=0;
 const singlePatch={op:"PATCH_SLOT",target:t("客厅"),slot:"temperature",value:23};
 out=await executePhysicalTransaction(runtime,singlePatch,{}, {}, async(input,patch)=>{
  singleCalls++;
  assert.equal(patch.target.area,"客厅");
  return {ok:true,runtime:input,receipts:[{single:true}],reason:null};
 });
 assert(out.ok);assert.equal(singleCalls,1);

 console.log(JSON.stringify({
  physical_transaction_router:"PASS",
  multi_target_sequential_fallback:0,
  atomic_batch_calls:1,
  single_target_route:1
 }));
})().catch(e=>{console.error(e);process.exit(1);});
