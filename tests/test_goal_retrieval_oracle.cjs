'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function diagnoseBenchmarkTurn('),end=html.indexOf('\nfunction runBenchmark()',start);
assert(start>=0&&end>start,'browser regression evaluator unavailable');
const code=html.slice(start,end);
function inspect(truth){
  const cap={capability_id:'model::module::brightness'};
  const env={
    CAPINDEX:{capabilities:[cap]},
    capabilityById:()=>({...cap,kind:'p'}),
    capabilityValueCheck:()=>({ok:true}),
    actualEntities:()=>['light'],actualAreas:()=>['客厅'],
    canonicalEntityName:()=>null,instanceKey:()=>'',nodePropertyKey:()=>''
  };
  const turn={type:'turn',expected:{scenario:true,goal:'movie_comfort'}};
  const result={
    delta:{op:'CREATE_TASK',metadata:{scenario_inference:{
      goal:'movie_comfort',planned_actions:1,capability_candidates:[cap],
      selected_capabilities:[{...cap,need:{value:30}}],truth
    }}},
    neural:{scores:[{label:'goal:movie_comfort'}]},
    exec:{nodes:[{target:{entity:'light'},slots:{property:'brightness',value:30,capability_id:cap.capability_id}}],route:'THING_MODEL_EXECUTE',outputs:[]}
  };
  const pre={intentTree:{}},post={intentTree:{},tasks:[],activeTask:null};
  vm.createContext(env);
  return Array.from(vm.runInContext(code+'\ndiagnoseBenchmarkTurn(turn,result,pre,post)',Object.assign(env,{turn,result,pre,post})));
}
assert.deepEqual(inspect('goal_semantic_state_plus_global_46_model_capability_retrieval_plus_commit_gate'),[]);
assert(inspect('unsupported_fake_retrieval_claim').includes('global_capability_retrieval'));
console.log('PASS goal-retrieval regression oracle accepts actual gated contract and rejects forged truth');
