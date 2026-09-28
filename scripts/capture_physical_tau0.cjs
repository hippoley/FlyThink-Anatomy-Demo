"use strict";

const fs=require("fs");
const crypto=require("crypto");
const {WindowPilotHttpDriver}=require("./windowpilot_http_driver.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function isoNow(now){return new Date(now()).toISOString()}
function key(t){return [t.area,t.entity,t.instance||"default"].join("::")}

function sanitizeEvidence(value){
  if(Array.isArray(value))return value.map(sanitizeEvidence);
  if(!value||typeof value!=="object")return value;
  const out={};
  for(const [k,v] of Object.entries(value)){
    if(/token|authorization|password|secret|api[_-]?key/i.test(k)){
      out[k]="[REDACTED]";
    }else{
      out[k]=sanitizeEvidence(v);
    }
  }
  return out;
}

function bundleHash(bundle){
  const copy=clone(bundle);
  delete copy.bundle_sha256;
  return crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}

function parseTarget(raw){
  if(!raw)throw new Error("--target-json is required");
  const t=typeof raw==="string"?JSON.parse(raw):raw;
  if(!t||!t.area||!t.entity)throw new Error("target requires area/entity");
  return {area:t.area,entity:t.entity,instance:t.instance||"default"};
}

function readPosition(state){
  const pct=Number(state&&state.thing_model&&state.thing_model.window_open_pct);
  if(!Number.isFinite(pct)||pct<0||pct>100)throw new Error("tau0_invalid_position_readback");
  return pct;
}

function actualIdentity(readiness){
  return readiness&&readiness.hardware_identity&&readiness.hardware_identity.identity_sha256||null;
}

function preflightViolations({readiness,state,expectedHardwareIdentity,tolerancePct,requireCapturePreconditions=true}){
  const violations=[];
  const actual=actualIdentity(readiness);
  const pct=readPosition(state);
  if(readiness&&readiness.physical_write_ready!==true)violations.push("physical_write_not_ready");
  if(requireCapturePreconditions&&readiness&&readiness.capture_preconditions!==true)violations.push("capture_preconditions_not_ready");
  if(!actual)violations.push("hardware_identity_unavailable");
  if(expectedHardwareIdentity&&actual!==expectedHardwareIdentity)violations.push("hardware_identity_mismatch");
  if(pct>tolerancePct)violations.push("baseline_not_closed");
  return {violations,actual,pct};
}

function patch(target,value){
  return {op:"PATCH_SLOT",target:clone(target),slot:"opening",value:Number(value)};
}

function observedPct(receipt){
  const pct=Number(receipt&&receipt.observation&&receipt.observation.evidence&&receipt.observation.evidence.position_pct);
  return Number.isFinite(pct)?pct:null;
}

async function captureTau0(options={}){
  const now=options.now||(()=>Date.now());
  const target=parseTarget(options.target);
  const apply=options.apply===true;
  const openPct=Number(options.openPct??20);
  const tolerancePct=Number(options.tolerancePct??1);
  const expectedHardwareIdentity=options.expectedHardwareIdentity||null;
  const maxOpenPct=Number(options.maxOpenPct??30);
  const requireCapturePreconditions=options.requireCapturePreconditions!==false;
  const driver=options.driver||new WindowPilotHttpDriver({
    baseUrl:options.baseUrl,
    target,
    expectedHardwareIdentity,
    tolerancePct,
    pollIntervalMs:Number(options.pollIntervalMs??200),
    timeoutMs:Number(options.timeoutMs??10000),
    maxPolls:options.maxPolls==null?null:Number(options.maxPolls),
    stopOnTimeout:true
  });

  if(!Number.isFinite(openPct)||openPct<=tolerancePct||openPct>maxOpenPct||openPct>100){
    throw new Error("tau0_open_pct_out_of_safe_range");
  }
  if(!Number.isFinite(tolerancePct)||tolerancePct<0||tolerancePct>5){
    throw new Error("tau0_tolerance_out_of_range");
  }
  if(apply&&!expectedHardwareIdentity){
    throw new Error("tau0_apply_requires_expected_hardware_identity");
  }

  const bundle={
    schema:"physical_tau0_capture.v1",
    truth:"measured_window_open_close_tau0",
    mode:apply?"APPLY":"DRY_RUN",
    started_at:isoNow(now),
    completed_at:null,
    target:clone(target),
    target_key:key(target),
    requested_open_pct:openPct,
    max_open_pct:maxOpenPct,
    tolerance_pct:tolerancePct,
    expected_hardware_identity:expectedHardwareIdentity,
    actual_hardware_identity:null,
    preflight:null,
    steps:[],
    invariants:{
      physical_write_ready:false,
      capture_preconditions:false,
      identity_match:false,
      baseline_closed:false,
      open_observed:false,
      final_closed:false
    },
    success:false,
    ready_for_apply:false,
    cleanup_required:false,
    error:null,
    bundle_sha256:null
  };

  let openStarted=false;
  let openReceipt=null;
  let closeReceipt=null;

  try{
    const readiness=await driver.readiness();
    const before=await driver.state();
    const pre=preflightViolations({
      readiness,
      state:before,
      expectedHardwareIdentity,
      tolerancePct,
      requireCapturePreconditions
    });
    bundle.actual_hardware_identity=pre.actual;
    bundle.preflight=sanitizeEvidence({
      readiness,
      state:before,
      position_pct:pre.pct,
      violations:pre.violations
    });
    bundle.invariants.physical_write_ready=readiness&&readiness.physical_write_ready===true;
    bundle.invariants.capture_preconditions=
      requireCapturePreconditions?readiness&&readiness.capture_preconditions===true:true;
    bundle.invariants.identity_match=!!pre.actual&&(!expectedHardwareIdentity||pre.actual===expectedHardwareIdentity);
    bundle.invariants.baseline_closed=pre.pct<=tolerancePct;
    bundle.ready_for_apply=pre.violations.length===0;

    bundle.steps.push({
      name:"preflight",
      status:bundle.ready_for_apply?"passed":"blocked",
      observed_position_pct:pre.pct,
      violations:pre.violations
    });

    if(!bundle.ready_for_apply){
      bundle.error={code:"tau0_preflight_failed",details:pre.violations};
      return bundle;
    }

    if(!apply){
      bundle.success=true;
      return bundle;
    }

    openStarted=true;
    openReceipt=await driver.execute(patch(target,openPct));
    const openObserved=observedPct(openReceipt);
    bundle.steps.push({
      name:"open",
      status:openReceipt&&openReceipt.status||"unknown",
      requested_position_pct:openPct,
      observed_position_pct:openObserved,
      receipt:sanitizeEvidence(openReceipt)
    });
    bundle.invariants.open_observed=
      openReceipt&&openReceipt.status==="applied"&&
      openObserved!=null&&Math.abs(openObserved-openPct)<=tolerancePct;

    if(!bundle.invariants.open_observed){
      bundle.error={
        code:"tau0_open_not_observed",
        details:{
          status:openReceipt&&openReceipt.status||"unknown",
          observed_position_pct:openObserved
        }
      };
    }
  }catch(e){
    bundle.error={code:"tau0_capture_exception",details:String(e&&e.message||e)};
  }finally{
    if(apply&&openStarted){
      try{
        closeReceipt=await driver.execute(patch(target,0));
        const closeObserved=observedPct(closeReceipt);
        bundle.steps.push({
          name:"close",
          status:closeReceipt&&closeReceipt.status||"unknown",
          requested_position_pct:0,
          observed_position_pct:closeObserved,
          receipt:sanitizeEvidence(closeReceipt)
        });
        bundle.invariants.final_closed=
          closeReceipt&&closeReceipt.status==="applied"&&
          closeObserved!=null&&closeObserved<=tolerancePct;
      }catch(e){
        bundle.steps.push({
          name:"close",
          status:"exception",
          receipt:null,
          error:String(e&&e.message||e)
        });
        bundle.invariants.final_closed=false;
      }
      bundle.cleanup_required=!bundle.invariants.final_closed;
      if(bundle.cleanup_required&&!bundle.error){
        bundle.error={code:"tau0_cleanup_not_confirmed",details:"final closed readback was not confirmed"};
      }
    }
    bundle.success=apply
      ? bundle.ready_for_apply&&bundle.invariants.open_observed&&bundle.invariants.final_closed&&!bundle.error
      : bundle.ready_for_apply&&!bundle.error;
    bundle.completed_at=isoNow(now);
    bundle.bundle_sha256=bundleHash(bundle);
  }

  return bundle;
}

function arg(name,argv=process.argv){
  const i=argv.indexOf(name);
  return i>=0?argv[i+1]:null;
}
function flag(name,argv=process.argv){return argv.includes(name)}

async function main(argv=process.argv){
  const target=parseTarget(arg("--target-json",argv));
  const outPath=arg("--out",argv);
  const bundle=await captureTau0({
    baseUrl:arg("--url",argv),
    target,
    apply:flag("--apply",argv),
    expectedHardwareIdentity:arg("--expected-hardware-identity",argv),
    openPct:Number(arg("--open-pct",argv)||20),
    tolerancePct:Number(arg("--tolerance",argv)||1),
    maxOpenPct:Number(arg("--max-open-pct",argv)||30),
    timeoutMs:Number(arg("--timeout-ms",argv)||10000),
    pollIntervalMs:Number(arg("--poll-ms",argv)||200),
    maxPolls:arg("--max-polls",argv)==null?null:Number(arg("--max-polls",argv))
  });
  const text=JSON.stringify(bundle,null,2)+"\n";
  if(outPath)fs.writeFileSync(outPath,text,{encoding:"utf8",mode:0o600});
  process.stdout.write(text);
  if(!bundle.success)process.exitCode=2;
}

if(require.main===module){
  main().catch(e=>{console.error(e);process.exit(1)});
}

module.exports={
  captureTau0,
  sanitizeEvidence,
  bundleHash,
  parseTarget,
  readPosition,
  preflightViolations,
  observedPct
};
