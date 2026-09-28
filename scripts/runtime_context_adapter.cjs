"use strict";
/** Derive model context only from actual persistent runtime + prior applied patches. */
function targetOf(p){return p&&p.target?{...p.target}:null}
function uniq(xs){const m=new Map();for(const x of xs||[]){if(x)m.set([x.area,x.entity,x.instance||"default"].join("::"),{...x});}return [...m.values()]}
function deriveContext(runtime,history=[]){
 const applied=history.filter(x=>x&&x.outcome==="EXECUTE"&&Array.isArray(x.applied_patches)).flatMap(x=>x.applied_patches);
 const last=applied[applied.length-1];
 const lastSet=last&&Array.isArray(last.targets)?last.targets:null;
 const focus=targetOf(last)||((lastSet&&lastSet.length===1)?lastSet[0]:null);
 const referent_set=lastSet&&lastSet.length?uniq(lastSet):(focus?[focus]:[]);
 return {
  focused_target:focus,
  referent_set,
  pending_ids:Object.keys((runtime&&runtime.pending)||{}).filter(k=>runtime.pending[k]&&runtime.pending[k].status!=="cancelled"),
  executed_ids:((runtime&&runtime.executionLedger)||[]).map(x=>x.id).filter(Boolean),
  protected_paths:Object.keys((runtime&&runtime.protectedInvariants)||{}),
  device_keys:Object.keys((runtime&&runtime.devices)||{}),
  device_registry:Object.fromEntries(Object.entries((runtime&&runtime.devices)||{}).filter(([,v])=>v&&v.model_id).map(([k,v])=>[k,{model_id:v.model_id}]))
 };
}
module.exports={deriveContext};
