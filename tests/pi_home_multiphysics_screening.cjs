"use strict";

const assert=require("assert");
const {evaluateCase}=require("../scripts/run_pi_home_multiphysics_screening.cjs");

const rain={
  id:"rain",
  context:{
    candidates:[
      {target:{area:"A",entity:"窗户",instance:"1"},features:{rain_exposure:.8}},
      {target:{area:"B",entity:"窗户",instance:"2"},features:{rain_exposure:.3}},
      {target:{area:"C",entity:"窗户",instance:"3"},features:{rain_exposure:.1}}
    ]
  },
  physics:{
    required_dimensions:["co2","rain_ingress"],
    dimension_weights:{co2:.3,rain_ingress:.7}
  }
};
const learned={id:"rain",predicted:{area:"C",entity:"窗户",instance:"3"}};
const real={
  case_id:"rain",
  status:"REAL_CONTAM_EXECUTED",
  backend:"contamxpy",
  physics_fidelity:"CONTAM",
  engine_version:"3.4.1.7-64bit",
  evidence_level:"real-contam-demo-profile",
  profile_trusted_for_promotion:false,
  branches:[
    {label:"candidate-1",end_co2_ppm:900},
    {label:"candidate-2",end_co2_ppm:850},
    {label:"candidate-3",end_co2_ppm:900}
  ]
};
const out=evaluateCase(rain,learned,real);
assert.equal(out.fusion.decision,"SCREENING_ALIGNED");
assert.equal(out.fusion.winner.label,"candidate-3");
assert.equal(out.fusion.trusted_for_generalization_claim,false);
assert.equal(out.providers.length,2);

const quiet={
  id:"quiet",
  context:{
    candidates:[
      {target:{area:"A",entity:"风机",instance:"1"},features:{noise_cost:.9}},
      {target:{area:"B",entity:"窗户",instance:"2"},features:{noise_cost:.1}}
    ]
  },
  physics:{required_dimensions:["co2","noise"]}
};
const q=evaluateCase(
  quiet,
  {id:"quiet",predicted:{area:"B",entity:"窗户",instance:"2"}},
  {case_id:"quiet",status:"BLOCKED"}
);
assert.equal(q.fusion.decision,"NOT_ADJUDICABLE");
assert.deepEqual(q.fusion.missing_dimensions,["co2"]);
assert.equal(q.fusion.trusted_for_generalization_claim,false);

console.log(JSON.stringify({
  ok:true,
  contract:"real CONTAM plus heuristic rain/noise evidence may produce screening rankings but never a trusted generalization claim"
}));
