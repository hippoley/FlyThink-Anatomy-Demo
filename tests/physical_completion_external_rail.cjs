"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {digestObject}=require("../scripts/execution_receipt.cjs");
const {
  SCHEMA,
  appraisePhysicalCompletion,
  main
}=require("../scripts/verify_physical_completion_vector_cli.cjs");

const T={area:"客厅",entity:"窗",instance:"default"};
const criterion={
  version:"windowpilot-completion-criterion.v1",
  target:T,
  slot:"opening",
  predicate:"abs(observed_position_pct-requested_position_pct)<=tolerance_pct",
  requested_position_pct:5,
  tolerance_pct:1,
  require_fresh_readback:true,
  witness_source:"windowpilot:/api/state",
  witness_method:"windowpilot-state-readback",
  expected_hardware_identity_sha256:"hw-1"
};
const criterionSha=digestObject(criterion);

function vector(over={}){
  const receipt={
    patch:{op:"PATCH_SLOT",target:T,slot:"opening",value:5},
    physical_patch:{op:"PATCH_SLOT",target:T,slot:"opening",value:5},
    command_id:"windowpilot:1",
    status:"applied",
    observation:{
      target:T,
      exists:true,
      slots:{opening:5},
      evidence:{
        source:"windowpilot:/api/state",
        position_pct:5,
        measured:true,
        tick:11,
        ack_at_ms:1000,
        received_at_ms:1001
      }
    },
    ack:{ok:true},
    before_tick:10,
    requested_position_pct:5,
    hardware_identity_before:"hw-1",
    hardware_identity_after:"hw-1",
    completion_criterion:criterion,
    completion_criterion_sha256:criterionSha,
    witness:{
      witness_id:"windowpilot-state:hw-1",
      source:"windowpilot:/api/state",
      method:"windowpilot-state-readback",
      hardware_identity_sha256:"hw-1"
    },
    criterion_fixed_at_ms:999,
    observation_window:{
      criterion_fixed_at_ms:999,
      ack_at_ms:1000,
      received_at_ms:1001
    }
  };
  Object.assign(receipt,over.receipt||{});
  if(over.observationEvidence){
    receipt.observation={
      ...receipt.observation,
      evidence:{...receipt.observation.evidence,...over.observationEvidence}
    };
  }
  return {
    schema_version:SCHEMA,
    authorized_completion_criterion:{
      criterion,
      criterion_sha256:
        over.authorizedCriterionSha===undefined
          ?criterionSha
          :over.authorizedCriterionSha
    },
    physical_receipt:receipt
  };
}

{
  const out=appraisePhysicalCompletion(vector());
  assert.equal(out.verdict,"valid");
  assert.equal(out.result,"PHYSICAL_COMPLETION_PROVEN");
  assert.deepEqual(out.codes,[]);
  assert.deepEqual(out.tiers,["identified-fresh-physical-witness"]);
  assert.equal(out.independent_object_outcome_verified,false);
}

{
  const out=appraisePhysicalCompletion(
    vector({observationEvidence:{position_pct:9}})
  );
  assert.equal(out.verdict,"valid");
  assert.equal(out.result,"PHYSICAL_COMPLETION_NOT_SATISFIED");
  assert.deepEqual(out.tiers,["identified-fresh-physical-witness"]);
}

{
  const v=vector();
  v.physical_receipt.ack={ok:false};
  const out=appraisePhysicalCompletion(v);
  assert.equal(out.verdict,"valid");
  assert.equal(out.result,"PHYSICAL_COMPLETION_PROVEN");
  assert.ok(out.codes.includes("ack-not-verified"));
  assert.deepEqual(out.tiers,["identified-fresh-physical-witness"]);
  assert.equal(out.independent_object_outcome_verified,false);
}

{
  const out=appraisePhysicalCompletion(
    vector({authorizedCriterionSha:"a".repeat(64)})
  );
  assert.equal(out.verdict,"invalid");
  assert.equal(out.result,null);
  assert.equal(out.independent_object_outcome_verified,false);
  assert.ok(out.codes.includes("completion-criterion-not-authorization-bound"));
}

{
  const v=vector();
  v.physical_receipt.observation.evidence.tick=10;
  const out=appraisePhysicalCompletion(v);
  assert.equal(out.verdict,"valid");
  assert.equal(out.result,"PHYSICAL_COMPLETION_INDETERMINATE");
  assert.ok(out.codes.includes("fresh-readback-not-verified"));
  assert.deepEqual(out.tiers,["physical-evidence-unresolved"]);
}

{
  const v=vector();
  v.physical_receipt.witness.independent=true;
  const out=appraisePhysicalCompletion(v);
  assert.equal(out.result,"PHYSICAL_COMPLETION_PROVEN");
  assert.deepEqual(out.tiers,["identified-fresh-physical-witness"]);
  assert.equal(out.independent_object_outcome_verified,false);
}

{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"flythink-completion-"));
  const file=path.join(dir,"vector.json");
  fs.writeFileSync(file,JSON.stringify(vector()));
  let stdout="";
  const write=process.stdout.write;
  process.stdout.write=(chunk)=>{stdout+=String(chunk);return true};
  try{
    const code=main([file]);
    assert.equal(code,0);
  }finally{
    process.stdout.write=write;
  }
  const lines=stdout.trim().split("\n");
  assert.equal(lines.length,1);
  const out=JSON.parse(lines[0]);
  assert.equal(out.verdict,"valid");
  assert.equal(out.result,"PHYSICAL_COMPLETION_PROVEN");
  assert.ok(Array.isArray(out.codes));
  assert.ok(Array.isArray(out.tiers));
  assert.equal(out.independent_object_outcome_verified,false);
}

console.log(JSON.stringify({
  ok:true,
  contract:"physical completion appraisal separates evidence-package validity from real-world completion status and speaks an external-verifier-shaped one-line JSON rail"
}));
