"use strict";

const {rankStrategyCandidates}=require("./pi_home_strategy_ranker.cjs");

async function runStrategyTournament({
  adapter,
  candidates,
  origin,
  constraints=[],
  objectives=[],
  horizon_minutes=30,
  request_id=""
}={}){
  if(!adapter||typeof adapter.simulateMany!=="function")throw new Error("strategy_batch_adapter_required");
  if(!Array.isArray(candidates)||!candidates.length)throw new Error("strategy_candidates_required");
  const outcomes=await adapter.simulateMany({
    candidates,
    origin,
    horizon_minutes,
    request_id
  });
  const ranking=rankStrategyCandidates(outcomes,{constraints,objectives});
  return {
    schema_version:"pi-home-strategy-tournament-v1",
    request_id,
    candidates:candidates.length,
    simulated:outcomes.length,
    outcomes,
    ranking,
    winner:ranking.winner
  };
}

module.exports={runStrategyTournament};
