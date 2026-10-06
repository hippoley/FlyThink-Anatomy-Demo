"use strict";

const fs=require("fs");

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}
function key(t){return [t.area,t.entity,t.instance||"default"].join("::")}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}

const manifest=JSON.parse(fs.readFileSync(arg("--manifest"),"utf8"));
const caseId=arg("--case");
const result=JSON.parse(fs.readFileSync(arg("--result"),"utf8"));
const eventLines=fs.readFileSync(arg("--events"),"utf8").split(/\r?\n/).filter(Boolean);
const events=eventLines.map(x=>JSON.parse(x));
const row=(manifest.cases||[]).find(x=>x.id===caseId);
if(!row)throw new Error("spoken_case_not_found:"+caseId);

const finals=events.filter(x=>x.kind==="final");
if(finals.length!==1)throw new Error("expected_exactly_one_final_asr_segment");
if(result.speculative_physical_commands!==0){
  throw new Error("spoken_partial_or_stable_reached_physical_driver");
}
if(result.physical_commands!==row.expected.physical_commands){
  throw new Error("spoken_physical_command_count_mismatch");
}

const finalTrace=(result.trace||[]).filter(x=>x.asr&&x.asr.is_final);
if(finalTrace.length!==1)throw new Error("spoken_final_trace_missing");
const trace=finalTrace[0];
if(trace.semantic.decision!==row.expected.decision){
  throw new Error("spoken_final_decision_mismatch:"+trace.semantic.decision);
}
if(!trace.committed)throw new Error("spoken_final_command_not_committed");

const patch=(trace.patch_proposal||[])[0];
if(!patch)throw new Error("spoken_patch_missing");
if(patch.op!==row.expected.op)throw new Error("spoken_patch_op_mismatch:"+patch.op);
const target=patch.target||((patch.targets||[]).length===1?patch.targets[0]:null);
if(!target||key(target)!==key(row.expected.target)){
  throw new Error("spoken_target_mismatch:"+JSON.stringify(target));
}

const device=(result.runtime.devices||{})[key(row.expected.target)];
if(!device)throw new Error("spoken_target_device_missing_after_reconcile");
if(device.slots[row.expected.slot]!==row.expected.value){
  throw new Error(
    "spoken_reconciled_slot_mismatch:"+JSON.stringify({
      slot:row.expected.slot,
      got:device.slots[row.expected.slot],
      expected:row.expected.value
    })
  );
}

console.log(JSON.stringify({
  ok:true,
  case:caseId,
  final_asr_text:finals[0].text,
  semantic_decision:trace.semantic.decision,
  op:patch.op,
  target,
  reconciled_slot:{[row.expected.slot]:device.slots[row.expected.slot]},
  physical_commands:result.physical_commands,
  speculative_physical_commands:result.speculative_physical_commands
}));
