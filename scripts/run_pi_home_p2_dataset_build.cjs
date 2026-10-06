"use strict";
const fs=require("fs");
const {buildPreferencePairs}=require("./pi_home_preference_pairs.cjs");
const {buildAdvantageDataset}=require("./pi_home_advantage.cjs");

function arg(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null}
const path=arg("--benchmark")||"benchmarks/pi_home_offline_replay.json";
const data=JSON.parse(fs.readFileSync(path,"utf8"));
const cases=data.cases||[];
const preferences=buildPreferencePairs(cases);
const advantages=buildAdvantageDataset(cases);

const out={
  schema_version:"pi-home-p2-dataset-build-v1",
  source:data.version||null,
  cases:cases.length,
  preference_pairs:preferences.pairs.length,
  preference_skipped:preferences.skipped.length,
  positive_advantage:advantages.positive_advantage,
  nonpositive_advantage:advantages.nonpositive_advantage,
  preferences,
  advantages
};
console.log(JSON.stringify(out,null,2));

if(out.preference_pairs<1)process.exitCode=2;
if(out.positive_advantage<1)process.exitCode=2;
