"use strict";
const fs=require("fs");
const {run}=require("./stateful_checkpoint_trajectory.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function key(t){return t&&[t.area,t.entity,t.instance||"default"].join("::")}
function target(area,entity){return {area,entity,instance:"default"}}
const ROOMS=["客厅","主卧","书房","次卧"];
const ENTITIES=["空调","灯","窗"];

function extractRoom(text){
  const xs=ROOMS.filter(x=>text.includes(x));
  return [...new Set(xs)];
}
function extractEntity(text){
  const xs=ENTITIES.filter(x=>text.includes(x));
  return [...new Set(xs)];
}
function number(text){
  const m=String(text).match(/-?\d+(?:\.\d+)?/);
  return m?Number(m[0]):null;
}
function directPatch(text){
  const rooms=extractRoom(text),entities=extractEntity(text);
  if(rooms.length!==1||entities.length!==1)return null;
  const area=rooms[0],entity=entities[0],t=target(area,entity),n=number(text);
  if(/更正|不是|不要|同时|和|跟|两处/.test(text))return null;
  if(entity==="空调"&&/温度/.test(text)&&n!=null)
    return {op:"PATCH_SLOT",target:t,slot:"temperature",value:n};
  if(entity==="灯"&&/亮度/.test(text)&&n!=null)
    return {op:"PATCH_SLOT",target:t,slot:"brightness",value:n};
  if(entity==="窗"&&/开度/.test(text)&&n!=null)
    return {op:"PATCH_SLOT",target:t,slot:"opening",value:n};
  if(/启动|打开|开启|给我开|开起来|开始工作/.test(text))
    return {op:"ADD_DEVICE",target:t,slots:{power:"ON"}};
  if(/停用|关闭|关掉|停掉|停止|停了/.test(text))
    return {op:"CLOSE_DEVICE",target:t};
  return null;
}
function relativePatch(text,context){
  const t=context&&context.focused_target;
  if(!t)return null;
  const relative=/再|继续|接着|刚才|上一个|维持|别换|沿用|基础/.test(text);
  if(!relative)return null;
  if(t.entity==="空调"&&/低/.test(text))
    return {op:"PATCH_RELATIVE",target:clone(t),slot:"temperature",delta:-1};
  if(t.entity==="灯"&&/亮/.test(text))
    return {op:"PATCH_RELATIVE",target:clone(t),slot:"brightness",delta:10};
  if(t.entity==="窗"&&/大|开/.test(text))
    return {op:"PATCH_RELATIVE",target:clone(t),slot:"opening",delta:10};
  return null;
}
function correctionPatch(text){
  if(!/更正|不是|不要|说错/.test(text))return null;
  const rooms=extractRoom(text),entities=extractEntity(text),n=number(text);
  if(!entities.length||rooms.length<2||n==null)return null;
  const entity=entities[entities.length-1];
  const area=rooms[rooms.length-1];
  const t=target(area,entity);
  if(entity==="空调")return {op:"PATCH_SLOT",target:t,slot:"temperature",value:n};
  if(entity==="灯")return {op:"PATCH_SLOT",target:t,slot:"brightness",value:n};
  if(entity==="窗")return {op:"PATCH_SLOT",target:t,slot:"opening",value:n};
  return null;
}
function multiPatch(text){
  if(!/同时|和|跟|两处/.test(text))return null;
  const rooms=extractRoom(text),entities=extractEntity(text),n=number(text);
  if(rooms.length!==2||entities.length!==1||n==null)return null;
  const entity=entities[0],targets=rooms.map(r=>target(r,entity));
  if(entity==="空调")return {op:"PATCH_SLOT",targets,slot:"temperature",value:n};
  if(entity==="灯")return {op:"PATCH_SLOT",targets,slot:"brightness",value:n};
  if(entity==="窗")return {op:"PATCH_SLOT",targets,slot:"opening",value:n};
  return null;
}

function predictor(name,turns){
  let i=0;
  return async req=>{
    const turn=turns[i++];
    if(name==="clarify_only")return {decision:"CLARIFY",patches:[]};
    if(name==="surface_direct"){
      const p=directPatch(req.text);
      return p?{decision:"EXECUTE",patches:[p]}:{decision:"CLARIFY",patches:[]};
    }
    if(name==="context_rule"){
      const p=correctionPatch(req.text)||multiPatch(req.text)||directPatch(req.text)||relativePatch(req.text,req.context);
      if(p)return {decision:"EXECUTE",patches:[p]};
      return {decision:"CLARIFY",patches:[]};
    }
    if(name==="gold_oracle"){
      if(!turn)throw new Error("gold_oracle_turn_underflow");
      if(turn.gold_decision!=="EXECUTE")return {decision:turn.gold_decision,patches:[]};
      const p={op:turn.gold_op};
      if(Array.isArray(turn.gold_target))p.targets=clone(turn.gold_target);else p.target=clone(turn.gold_target);
      if(turn.gold_slot!==undefined)p.slot=turn.gold_slot;
      if(turn.gold_value!==undefined)p.value=clone(turn.gold_value);
      if(turn.gold_delta!==undefined)p.delta=turn.gold_delta;
      if(turn.gold_slots!==undefined)p.slots=clone(turn.gold_slots);
      return {decision:"EXECUTE",patches:[p]};
    }
    throw new Error("unknown_baseline:"+name);
  };
}
function aggregateInit(){return {trajectories:0,turns:0,decision:0,patch:0,state:0,strict:0,unsafe:0,wrong:0,untouched:0}}
function add(a,r,tr){
  const n=tr.turns.length;
  a.trajectories++;a.turns+=n;
  a.decision+=Math.round(r.decision_exact*n);
  a.patch+=Math.round(r.full_patch_exact*n);
  a.state+=Math.round(r.state_after_turn_exact*n);
  if(r.strict_trajectory_exact)a.strict++;
  a.unsafe+=r.unsafe_execute;a.wrong+=r.wrong_device;a.untouched+=r.untouched_state_violation;
}
function finish(a){
  return {
    trajectories:a.trajectories,turns:a.turns,
    decision_exact:a.decision/a.turns,
    full_patch_exact:a.patch/a.turns,
    state_after_turn_exact:a.state/a.turns,
    strict_trajectory_rate:a.strict/a.trajectories,
    unsafe_execute:a.unsafe,wrong_device:a.wrong,untouched_state_violation:a.untouched
  };
}
async function evaluate(file,split="sealed"){
  const d=JSON.parse(fs.readFileSync(file,"utf8"));
  const rows=d.trajectories.filter(x=>split==="all"||x.split===split);
  const names=["clarify_only","surface_direct","context_rule","gold_oracle"];
  const out={schema_version:"benchmark-v3-baseline-discrimination-v1",benchmark_release_id:d.manifest.release_id,split,baselines:{}};
  for(const name of names){
    const agg=aggregateInit();
    for(const tr of rows){
      const r=await run(tr,{predictor:predictor(name,tr.turns)});
      add(agg,r,tr);
    }
    out.baselines[name]=finish(agg);
  }
  const weak=["clarify_only","surface_direct","context_rule"];
  const bestWeak=Math.max(...weak.map(x=>out.baselines[x].full_patch_exact));
  out.discrimination={
    gold_full_patch_exact:out.baselines.gold_oracle.full_patch_exact,
    best_non_oracle_full_patch_exact:bestWeak,
    gold_margin:out.baselines.gold_oracle.full_patch_exact-bestWeak,
    trivial_baseline_strict_max:Math.max(...weak.map(x=>out.baselines[x].strict_trajectory_rate))
  };
  return out;
}
function arg(n){const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:null}
if(require.main===module){
  evaluate(arg("--benchmark")||"benchmark-v3.json",arg("--split")||"sealed")
    .then(x=>console.log(JSON.stringify(x)))
    .catch(e=>{console.error(e);process.exit(1)});
}
module.exports={extractRoom,extractEntity,directPatch,relativePatch,correctionPatch,multiPatch,predictor,evaluate};
