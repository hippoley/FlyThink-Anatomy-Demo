"use strict";

const assert=require("assert");
const {
  AirTrajectoryCounterfactualAdapter,
  classifySimulationTrust,
  selectExactBranch
}=require("../scripts/airtrajectory_counterfactual_adapter.cjs");

const target={area:"客厅",entity:"窗户",instance:"default"};
const patch={op:"PATCH_SLOT",target,slot:"opening",value:75};
const origin={
  co2_ppm:{living:1400,bedroom:980,study:840},
  opening_pct:{W1:50,W2:0,W3:0,D1:100,D2:100}
};

(async()=>{
  let seen=null;
  const toy=new AirTrajectoryCounterfactualAdapter({
    opening_map:{"客厅::窗户::default":"W1"},
    transport:async req=>{
      seen=req;
      return {
        trace_id:"toy-trace",
        topology_id:"demo-3zone",
        backend:"toy-multizone-v1",
        horizon_minutes:30,
        branches:[
          {target_pct:50,end_co2_ppm:1100,series:[1400,1100],return:-2,provenance:"backend-generated · toy-multizone-v1 · not engineering truth"},
          {target_pct:75,end_co2_ppm:900,series:[1400,1150,900],return:-1,provenance:"backend-generated · toy-multizone-v1 · not engineering truth"}
        ]
      };
    }
  });
  const out=await toy.simulate({patch,origin,request_id:"shadow-1"});
  assert.equal(seen.opening_id,"W1");
  assert.equal(seen.origin.co2_ppm.living,1400);
  assert.equal(out.provenance,"counterfactual_simulation");
  assert.equal(out.result.target_pct,75);
  assert.equal(out.result.end_co2_ppm,900);
  assert.equal(out.trusted_for_promotion,false);
  assert.equal(out.simulator.trust_reason,"toy_backend_not_engineering_truth");

  const contamTrust=classifySimulationTrust(
    {backend:"contamxpy",physics_fidelity:"CONTAM",trusted_for_promotion:true},
    {provenance:"backend-generated · CONTAM",trusted_for_promotion:true}
  );
  assert.equal(contamTrust.trusted_for_promotion,true);

  let contamSeen=null;
  const contam=new AirTrajectoryCounterfactualAdapter({
    endpoint:"/fork/contam",
    profile_id:"home-v1",
    opening_map:{"客厅::窗户::default":"W1"},
    transport:async req=>{
      contamSeen=req;
      return {
        backend:"contamxpy",
        physics_fidelity:"CONTAM",
        trusted_for_promotion:true,
        branches:[{
          target_pct:75,
          end_co2_ppm:850,
          series:[1400,1100,850],
          return:1.2,
          provenance:"backend-generated · CONTAM",
          trusted_for_promotion:true
        }]
      };
    }
  });
  const contamOut=await contam.simulate({patch,origin,request_id:"contam-shadow"});
  assert.equal(contamSeen.profile_id,"home-v1");
  assert.equal(contamSeen.topology_id,undefined);
  assert.equal(contamOut.trusted_for_promotion,true);

  assert.throws(()=>selectExactBranch({branches:[{target_pct:50}]},75),/exact_branch_missing/);

  console.log(JSON.stringify({
    ok:true,
    contract:"AirTrajectory counterfactual adapter preserves simulator provenance and rejects toy evidence for promotion"
  }));
})().catch(e=>{console.error(e);process.exit(1)});
