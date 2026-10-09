"use strict";
const fs=require("fs");
const {createCheckpointClient}=require("./stateful_checkpoint_trajectory.cjs");
const {deriveSemanticContext}=require("./contextual_edge_slu_adapter.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function key(t){return t&&[t.area,t.entity,t.instance||"default"].join("::")}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function goldPatch(t){
  if(t.gold_decision!=="EXECUTE")return null;
  const p={op:t.gold_op};
  if(Array.isArray(t.gold_target))p.targets=clone(t.gold_target);
  else if(t.gold_target)p.target=clone(t.gold_target);
  if(t.gold_slot!==undefined)p.slot=t.gold_slot;
  if(t.gold_value!==undefined)p.value=clone(t.gold_value);
  if(t.gold_delta!==undefined)p.delta=t.gold_delta;
  if(t.gold_slots!==undefined)p.slots=clone(t.gold_slots);
  return p;
}
function targetKeys(p){
  if(!p)return [];
  if(p.target)return [key(p.target)];
  return (p.targets||[]).map(key).sort();
}
function runtimeAtGoldPrefix(tr,index){
  const runtime=clone(tr.initial_runtime||{});
  if(index===0)return runtime;
  const gold=tr.turns[index-1].gold_state;
  if(!gold)throw new Error("gold_prefix_state_missing:"+tr.id+":"+index);
  for(const [k,slots] of Object.entries(gold)){
    if(!runtime.devices[k])throw new Error("gold_prefix_device_missing:"+k);
    runtime.devices[k].slots=clone(slots);
  }
  return runtime;
}
function goldHistoryPrefix(tr,index){
  const out=[];
  for(let i=0;i<index;i++){
    const t=tr.turns[i];
    const p=goldPatch(t);
    out.push({
      text:t.text,
      outcome:t.gold_decision,
      predicted:t.gold_decision,
      gold:t.gold_decision,
      ok:true,
      state_ok:true,
      error:null,
      committed:t.gold_decision==="EXECUTE",
      applied_patches:p?[p]:[],
      physical_receipts:[]
    });
  }
  return out;
}
function classify(turn,pred){
  if(!pred||typeof pred!=="object")return {ok:false,primary:"missing_prediction",dimensions:["prediction"]};
  const dims=[];
  if(pred.decision!==turn.gold_decision)dims.push("decision");
  if(turn.gold_decision==="EXECUTE"){
    const p=(pred.patches||[])[0];
    if(!p)dims.push("missing_patch");
    else{
      if(p.op!==turn.gold_op)dims.push("operation");
      if(JSON.stringify(targetKeys(p))!==JSON.stringify(targetKeys(goldPatch(turn))))dims.push("target");
      if(turn.gold_slot!==undefined&&p.slot!==turn.gold_slot)dims.push("slot");
      if(turn.gold_value!==undefined&&!eq(p.value,turn.gold_value))dims.push("value");
      if(turn.gold_delta!==undefined&&!eq(p.delta,turn.gold_delta))dims.push("delta");
      if(turn.gold_slots!==undefined&&!eq(p.slots,turn.gold_slots))dims.push("slots");
    }
  }else if((pred.patches||[]).length)dims.push("nonexecute_patch");
  const priority=["decision","missing_patch","operation","target","slot","value","delta","slots","nonexecute_patch","prediction"];
  return {ok:dims.length===0,primary:priority.find(x=>dims.includes(x))||null,dimensions:dims};
}
function bucket(){return {turns:0,exact:0}}
function add(b,ok){b.turns++;if(ok)b.exact++}
function finish(b){return {turns:b.turns,exact:b.turns?b.exact/b.turns:0}}

async function evaluate(file,args={}){
  const d=JSON.parse(fs.readFileSync(file,"utf8"));
  const split=args.split||"sealed";
  const rows=d.trajectories.filter(x=>split==="all"||x.split===split);
  if(!rows.length)throw new Error("benchmark_split_empty:"+split);
  const client=createCheckpointClient(args);
  const overall=bucket(),families={},generalization={},difficulty={},naming={},shapes={},taxonomy={},rowsOut=[];
  try{
    for(const tr of rows){
      for(let i=0;i<tr.turns.length;i++){
        const turn=tr.turns[i];
        const runtime=runtimeAtGoldPrefix(tr,i);
        const history=goldHistoryPrefix(tr,i);
        const derived=deriveSemanticContext(runtime,history);
        const context={...derived,...(turn.context_hint||{})};
        const pred=await client.predict({text:turn.text,context,background:{...context,...(turn.background||{})}});
        const cls=classify(turn,pred);
        add(overall,cls.ok);
        const fam=turn.scenario_family||"unknown";
        const gen=turn.generalization_class||"unknown";
        const diff=String(turn.difficulty??"unknown");
        const nc=turn.surface_naming_class||"legacy_unlabelled";
        const sh=turn.instruction_shape||"legacy_unlabelled";
        families[fam]??=bucket();generalization[gen]??=bucket();difficulty[diff]??=bucket();naming[nc]??=bucket();shapes[sh]??=bucket();
        add(families[fam],cls.ok);add(generalization[gen],cls.ok);add(difficulty[diff],cls.ok);add(naming[nc],cls.ok);add(shapes[sh],cls.ok);
        if(!cls.ok){
          taxonomy[cls.primary]=(taxonomy[cls.primary]||0)+1;
          rowsOut.push({
            trajectory:tr.id,turn:i+1,turn_id:turn.turn_id||null,text:turn.text,
            family:fam,generalization_class:gen,difficulty:turn.difficulty,
            gold_decision:turn.gold_decision,predicted_decision:pred.decision,
            primary_failure:cls.primary,failure_dimensions:cls.dimensions,
            gold_patch:goldPatch(turn),predicted_patch:(pred.patches||[])[0]||null
          });
        }
      }
    }
  }finally{await client.close()}
  return {
    schema_version:"benchmark-v3-teacher-forced-local-eval-v1",
    benchmark_truth:d.manifest.truth,
    benchmark_release_id:d.manifest.release_id,
    split,
    trajectories:rows.length,
    overall:finish(overall),
    by_scenario_family:Object.fromEntries(Object.entries(families).map(([k,v])=>[k,finish(v)])),
    by_generalization_class:Object.fromEntries(Object.entries(generalization).map(([k,v])=>[k,finish(v)])),
    by_difficulty:Object.fromEntries(Object.entries(difficulty).map(([k,v])=>[k,finish(v)])),
    by_surface_naming_class:Object.fromEntries(Object.entries(naming).map(([k,v])=>[k,finish(v)])),
    by_instruction_shape:Object.fromEntries(Object.entries(shapes).map(([k,v])=>[k,finish(v)])),
    primary_failure_taxonomy:taxonomy,
    failures:rowsOut
  };
}
function arg(n){const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:null}
if(require.main===module){
  const file=arg("--benchmark")||"benchmark-v3.json";
  evaluate(file,{
    split:arg("--split")||"sealed",
    graph:arg("--graph"),judgement:arg("--judgement"),semantic:arg("--semantic")
  }).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exit(1)});
}
module.exports={goldPatch,targetKeys,runtimeAtGoldPrefix,goldHistoryPrefix,classify,evaluate};
