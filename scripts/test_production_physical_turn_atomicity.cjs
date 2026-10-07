"use strict";
const assert=require("assert");
const {normalizeRuntime,applyTurn}=require("./whole_home_patch_contract.cjs");
const {executePhysicalTurn}=require("./physical_runtime.cjs");
const {PHYSICAL_CAPABILITIES}=require("./physical_driver_capabilities.cjs");
const t=area=>({area,entity:"空调",instance:"default"});

let runtime=normalizeRuntime();
runtime=applyTurn(runtime,[
 {op:"ADD_DEVICE",target:t("客厅"),slots:{temperature:24}},
 {op:"ADD_DEVICE",target:t("主卧"),slots:{temperature:25}}
]).runtime;
const before=JSON.parse(JSON.stringify(runtime));
const setPatch={op:"PATCH_SLOT",targets:[t("客厅"),t("主卧")],slot:"temperature",value:22};

(async()=>{
 let sequential=0;
 let out=await executePhysicalTurn(runtime,[setPatch],{execute(){sequential++;}}, {});
 assert.equal(out.ok,false);
 assert.equal(sequential,0);
 assert.deepStrictEqual(out.runtime,before);
 assert.equal(out.receipts.length,0);

 let batch=0;
 const driver={
  capabilities(){return [PHYSICAL_CAPABILITIES.ATOMIC_MULTI_TARGET_SET,PHYSICAL_CAPABILITIES.READBACK];},
  execute(){throw new Error("production_must_not_fallback_to_sequential");},
  executeAtomicBatch(patches){
   batch++;
   return patches.map((p,i)=>({id:"prod:"+(i+1),status:"applied",observation:{target:p.target,exists:true,slots:{temperature:p.value}}}));
  }
 };
 out=await executePhysicalTurn(runtime,[setPatch],driver,{turn_id:"turn-prod"});
 assert(out.ok);assert.equal(batch,1);
 assert.equal(out.runtime.devices["客厅::空调::default"].slots.temperature,22);
 assert.equal(out.runtime.devices["主卧::空调::default"].slots.temperature,22);
 assert(out.receipts.every(x=>x.atomic_batch===true));

 console.log(JSON.stringify({
  production_physical_turn_atomicity:"PASS",
  sequential_fallback:0,
  atomic_batch_calls:1,
  partial_runtime_commit:0
 }));
})().catch(e=>{console.error(e);process.exit(1);});
