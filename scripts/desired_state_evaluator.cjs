"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

function getPath(root,path){
  if(path==null||path==="")return root;
  const parts=Array.isArray(path)?path:String(path).split(".");
  let cur=root;
  for(const part of parts){
    if(cur==null||!Object.prototype.hasOwnProperty.call(cur,part))return undefined;
    cur=cur[part];
  }
  return cur;
}

function compare(actual,clause){
  const op=clause.op||"==";
  const expected=clause.value;
  switch(op){
    case "==": return actual===expected;
    case "!=": return actual!==expected;
    case "<": return typeof actual==="number"&&actual<expected;
    case "<=": return typeof actual==="number"&&actual<=expected;
    case ">": return typeof actual==="number"&&actual>expected;
    case ">=": return typeof actual==="number"&&actual>=expected;
    case "between":
      return typeof actual==="number"&&actual>=clause.min&&actual<=clause.max;
    case "in":
      return Array.isArray(expected)&&expected.includes(actual);
    case "truthy": return !!actual;
    case "falsy": return !actual;
    default: throw new Error("unsupported_desired_state_operator:"+op);
  }
}

function normalizeClauses(desiredState){
  if(!desiredState)return [];
  if(Array.isArray(desiredState))return desiredState;
  if(Array.isArray(desiredState.all))return desiredState.all;
  throw new Error("desired_state_requires_clause_array");
}

function resolveActual(clause,{runtime={},observation={}}={}){
  const source=clause.source||"observation";
  if(source==="observation")return getPath(observation,clause.path);
  if(source==="runtime")return getPath(runtime,clause.path);
  if(source==="device_slot"){
    const target=clause.target||{};
    const key=[target.area,target.entity,target.instance||"default"].join("::");
    const device=(runtime.devices||{})[key];
    return device&&device.slots?device.slots[clause.slot]:undefined;
  }
  throw new Error("unsupported_desired_state_source:"+source);
}

function evaluateDesiredState(desiredState,context={}){
  const clauses=normalizeClauses(desiredState);
  const results=clauses.map((clause,index)=>{
    const actual=resolveActual(clause,context);
    const missing=actual===undefined;
    const satisfied=!missing&&compare(actual,clause);
    return {
      index,
      id:clause.id||null,
      source:clause.source||"observation",
      path:clause.path||null,
      target:clone(clause.target||null),
      slot:clause.slot||null,
      op:clause.op||"==",
      expected:clause.value!==undefined?clone(clause.value):(
        clause.op==="between"?{min:clause.min,max:clause.max}:null
      ),
      actual:clone(actual),
      missing,
      satisfied,
      required:clause.required!==false,
      weight:typeof clause.weight==="number"?clause.weight:1
    };
  });
  const required=results.filter(x=>x.required);
  const missingRequired=required.filter(x=>x.missing);
  const weighted=results.reduce((a,x)=>a+(x.satisfied?x.weight:0),0);
  const totalWeight=results.reduce((a,x)=>a+x.weight,0);
  const configured=results.length>0;
  const ready=configured&&missingRequired.length===0;
  const satisfied=ready&&required.every(x=>x.satisfied);
  return {
    configured,
    ready,
    satisfied,
    score:totalWeight?weighted/totalWeight:0,
    clauses:results,
    deficits:results.filter(x=>!x.satisfied),
    missing:results.filter(x=>x.missing),
    missing_required:missingRequired
  };
}

module.exports={getPath,evaluateDesiredState,normalizeClauses,resolveActual};
