"use strict";

const cp=require("child_process");
const readline=require("readline");
const {normalizeRuntime}=require("./whole_home_patch_contract.cjs");
const {deriveContext}=require("./runtime_context_adapter.cjs");
const {loadBindings,executeSemanticTurnAsync}=require("./physical_runtime_protocol.cjs");
const {WindowPilotTransport}=require("./windowpilot_transport.cjs");

function arg(name, fallback=null) {
  const i=process.argv.indexOf(name);
  return i>=0 ? process.argv[i+1] : fallback;
}

function numberArg(name, fallback=null) {
  const raw=arg(name,null);
  if(raw==null) return fallback;
  const n=Number(raw);
  if(!Number.isFinite(n)) throw new Error(name+"_must_be_number");
  return n;
}

function checkpointClient(args) {
  const py=cp.spawn("python",[
    "scripts/checkpoint_jsonl_server.py",
    "--graph",args.graph,
    "--judgement",args.judgement,
    "--semantic",args.semantic
  ],{stdio:["pipe","pipe","inherit"]});

  const rl=readline.createInterface({input:py.stdout});
  const queue=[];
  let failure=null;

  function rejectAll(error) {
    failure=error instanceof Error?error:new Error(String(error));
    while(queue.length) queue.shift().reject(failure);
  }

  rl.on("line",line=>{
    const q=queue.shift();
    if(!q) return;
    try{q.resolve(JSON.parse(line));}
    catch(error){q.reject(error);}
  });
  py.on("error",rejectAll);
  py.on("exit",(code,signal)=>{
    if(code!==0) rejectAll(new Error("checkpoint_server_exit:"+code+":"+(signal||"")));
  });

  return {
    predict(payload) {
      return new Promise((resolve,reject)=>{
        if(failure) return reject(failure);
        const entry={resolve,reject};
        const timer=setTimeout(()=>{
          const i=queue.indexOf(entry);
          if(i>=0) queue.splice(i,1);
          reject(new Error("checkpoint_server_timeout"));
        },15000);
        entry.resolve=value=>{clearTimeout(timer);resolve(value);};
        entry.reject=error=>{clearTimeout(timer);reject(error);};
        queue.push(entry);
        py.stdin.write(JSON.stringify(payload)+"\n",error=>{
          if(error) entry.reject(error);
        });
      });
    },
    close(){py.stdin.end();}
  };
}

async function main() {
  const args={
    graph:arg("--graph"),
    judgement:arg("--judgement"),
    semantic:arg("--semantic"),
    text:arg("--text"),
    expectedOpening:numberArg("--expected-opening"),
    maxExcursion:numberArg("--max-excursion-pct",5)
  };
  for(const key of ["graph","judgement","semantic","text"]){
    if(!args[key]) throw new Error(key+"_required");
  }
  if(!Number.isFinite(args.expectedOpening) || args.expectedOpening<0 || args.expectedOpening>100){
    throw new Error("expected_opening_required_in_0_100");
  }
  if(!Number.isFinite(args.maxExcursion) || args.maxExcursion<=0 || args.maxExcursion>100){
    throw new Error("max_excursion_pct_invalid");
  }

  const transport=new WindowPilotTransport();
  const readiness=await transport.preflight();
  const current=Number(readiness.latest_position_feedback.position_pct);
  const excursion=Math.abs(args.expectedOpening-current);
  if(excursion>args.maxExcursion){
    throw new Error(
      "bounded_motion_gate:"+excursion.toFixed(2)+">"+args.maxExcursion.toFixed(2)
    );
  }

  const TARGET={area:"客厅",entity:"窗户",instance:"default"};
  let runtime=normalizeRuntime({
    devices:{
      "客厅::窗户::default":{
        key:"客厅::窗户::default",
        area:"客厅",
        entity:"窗户",
        instance:"default",
        status:"mounted",
        model_id:"CWDS-CA01",
        slots:{opening:current},
        physical_binding:{
          entity_id:"physical_dev_home_001.window.combo01",
          semantic_role:"exterior_window"
        }
      }
    }
  });

  const context={
    ...deriveContext(runtime,[]),
    focused_target:TARGET
  };

  const client=checkpointClient(args);
  try{
    const prediction=await client.predict({
      text:args.text,
      context,
      background:context
    });

    const result=await executeSemanticTurnAsync({
      runtime,
      proposal:prediction,
      commit_state:"SAFE_TO_COMMIT",
      transport,
      bindings:loadBindings()
    });
    runtime=result.runtime;

    const finalOpening=runtime.devices["客厅::窗户::default"].slots.opening;
    const confirmed=(
      result.outcome==="EXECUTE"
      && result.physical_status==="CONFIRMED"
      && Number.isFinite(finalOpening)
      && Math.abs(finalOpening-args.expectedOpening)<=1
    );

    const report={
      truth:"real_checkpoint_to_windowpilot_to_cwds_measured_reconcile_v1",
      text:args.text,
      hardware_identity_sha256:readiness.hardware_identity.identity_sha256,
      initial_opening:current,
      expected_opening:args.expectedOpening,
      max_excursion_pct:args.maxExcursion,
      prediction,
      outcome:result.outcome,
      physical_status:result.physical_status,
      receipts:result.receipts,
      final_opening:finalOpening,
      confirmed
    };
    console.log(JSON.stringify(report));
    if(!confirmed) process.exitCode=2;
  } finally {
    client.close();
  }
}

main().catch(error=>{
  console.error(JSON.stringify({
    truth:"real_checkpoint_to_windowpilot_to_cwds_measured_reconcile_v1",
    status:"BLOCKED_OR_FAILED",
    error:String(error && error.message || error)
  }));
  process.exit(1);
});
