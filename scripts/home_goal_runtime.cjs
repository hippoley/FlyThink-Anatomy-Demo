"use strict";

const {
  deviceKey,
  normalizeRuntime,
  expandSetPatch
}=require("./whole_home_patch_contract.cjs");
const {executePhysicalTurn}=require("./physical_runtime.cjs");
const {evaluateDesiredState}=require("./desired_state_evaluator.cjs");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b)}

function slotPath(target,slot){
  return deviceKey(target)+"::slots::"+slot;
}

function patchSlot(patch){
  if(!patch)return null;
  if(["PATCH_SLOT","PATCH_RELATIVE"].includes(patch.op))return patch.slot||null;
  if(patch.op==="CLOSE_DEVICE")return patch.slot||"power";
  return null;
}

function currentSlot(runtime,target,slot){
  const d=(runtime.devices||{})[deviceKey(target)];
  if(!d||!Object.prototype.hasOwnProperty.call(d.slots||{},slot)){
    return {exists:false,value:undefined};
  }
  return {exists:true,value:clone(d.slots[slot])};
}

function expandedPatchCount(patches){
  let n=0;
  for(const proposed of patches||[])n+=expandSetPatch(proposed).length;
  return n;
}

function strategySignature(strategy){
  if(strategy==null)return "null";
  if(typeof strategy==="string")return strategy;
  if(strategy&&typeof strategy.name==="string")return strategy.name;
  return JSON.stringify(strategy);
}

function classifyEpisodeOutcome(reason){
  if(reason==="goal_completed"){
    return {label:"SUCCESS",success:true,intervention_recommended:false};
  }
  if(["required_observation_missing","desired_state_not_configured"].includes(reason)){
    return {label:"BLOCKED_EVIDENCE",success:false,intervention_recommended:true};
  }
  if(reason==="progress_stalled"){
    return {label:"STALLED",success:false,intervention_recommended:true};
  }
  if(reason==="strategy_oscillation"){
    return {label:"OSCILLATION",success:false,intervention_recommended:true};
  }
  if(["action_budget_exceeded","action_budget_exhausted","step_budget_exhausted","duration_budget_exceeded"].includes(reason)){
    return {label:"BUDGET_EXHAUSTED",success:false,intervention_recommended:true};
  }
  return {label:"INCOMPLETE",success:false,intervention_recommended:true};
}

class HomeGoalRuntime{
  constructor({initialRuntime={},driver}={}){
    if(!driver)throw new Error("goal_runtime_driver_required");
    this.runtime=normalizeRuntime(initialRuntime);
    this.driver=driver;
  }

  episodeKey(goalId){return "goal:"+goalId}

  getEpisode(goalId){
    return this.runtime.tasks[this.episodeKey(goalId)]||null;
  }

  requireActive(goalId){
    const ep=this.getEpisode(goalId);
    if(!ep)throw new Error("goal_episode_not_found:"+goalId);
    if(ep.status!=="active")throw new Error("goal_episode_not_active:"+goalId);
    return ep;
  }

  beginGoal({id,goal,strategy=null,desired_state=null,constraints=null,metadata=null}={}){
    if(!id)throw new Error("goal_id_required");
    if(!goal)throw new Error("goal_required");
    const key=this.episodeKey(id);
    if(this.runtime.tasks[key]&&this.runtime.tasks[key].status==="active"){
      throw new Error("goal_episode_already_active:"+id);
    }
    this.runtime.tasks[key]={
      kind:"goal_episode",
      id,
      status:"active",
      goal:clone(goal),
      strategy:clone(strategy),
      desired_state:clone(desired_state),
      constraints:clone(constraints),
      metadata:clone(metadata),
      agent_owned:{},
      strategy_history:[],
      feedback:[],
      started_revision:(this.runtime.revisions||[]).length
    };
    return clone(this.runtime.tasks[key]);
  }

  updateStrategy(goalId,strategy,{reason=null,feedback=null}={}){
    const ep=this.requireActive(goalId);
    ep.strategy_history.push({
      from:clone(ep.strategy),
      to:clone(strategy),
      reason,
      feedback:clone(feedback)
    });
    ep.strategy=clone(strategy);
    if(feedback!=null)ep.feedback.push(clone(feedback));
    return clone(ep);
  }

  noteFeedback(goalId,feedback){
    const ep=this.requireActive(goalId);
    ep.feedback.push(clone(feedback));
    return clone(ep);
  }

  evaluateGoal(goalId,observation={}){
    const ep=this.requireActive(goalId);
    const evaluation=evaluateDesiredState(ep.desired_state,{
      runtime:this.runtime,
      observation
    });
    ep.last_evaluation=clone(evaluation);
    ep.last_observation=clone(observation);
    return clone(evaluation);
  }

  async recheckGoal(goalId,{observation={},planner=null,turn_id=null,max_actions=null}={}){
    const evaluation=this.evaluateGoal(goalId,observation);
    if(!evaluation.configured){
      return {
        completed:false,
        action_taken:false,
        blocked_reason:"desired_state_not_configured",
        evaluation:clone(evaluation),
        runtime:normalizeRuntime(this.runtime),
        episode:clone(this.requireActive(goalId))
      };
    }
    if(!evaluation.ready){
      return {
        completed:false,
        action_taken:false,
        blocked_reason:"required_observation_missing",
        evaluation:clone(evaluation),
        runtime:normalizeRuntime(this.runtime),
        episode:clone(this.requireActive(goalId))
      };
    }
    if(evaluation.satisfied){
      const ep=this.requireActive(goalId);
      ep.status="completed";
      ep.completed=true;
      ep.completed_observation=clone(observation);
      return {
        completed:true,
        action_taken:false,
        evaluation:clone(evaluation),
        runtime:normalizeRuntime(this.runtime),
        episode:clone(ep)
      };
    }
    if(typeof planner!=="function"){
      return {
        completed:false,
        action_taken:false,
        evaluation:clone(evaluation),
        runtime:normalizeRuntime(this.runtime),
        episode:clone(this.requireActive(goalId))
      };
    }
    const ep=this.requireActive(goalId);
    const proposal=await planner({
      goal:clone(ep.goal),
      strategy:clone(ep.strategy),
      desired_state:clone(ep.desired_state),
      constraints:clone(ep.constraints),
      evaluation:clone(evaluation),
      observation:clone(observation),
      runtime:normalizeRuntime(this.runtime)
    })||{};
    const patches=Array.isArray(proposal.patches)?proposal.patches:[];
    const proposedActions=expandedPatchCount(patches);
    if(max_actions!=null&&proposedActions>max_actions){
      return {
        completed:false,
        action_taken:false,
        blocked_reason:"action_budget_exceeded",
        proposed_actions:proposedActions,
        remaining_actions:max_actions,
        evaluation:clone(evaluation),
        proposal:clone(proposal),
        runtime:normalizeRuntime(this.runtime),
        episode:clone(this.requireActive(goalId))
      };
    }
    if(proposal.strategy!==undefined){
      this.updateStrategy(goalId,proposal.strategy,{
        reason:proposal.reason||"autonomous_recheck",
        feedback:proposal.feedback||null
      });
    }
    if(!patches.length){
      return {
        completed:false,
        action_taken:false,
        evaluation:clone(evaluation),
        proposal:clone(proposal),
        runtime:normalizeRuntime(this.runtime),
        episode:clone(this.requireActive(goalId))
      };
    }
    const applied=await this.applyAgentPatches(goalId,patches,{
      turn_id:turn_id||("recheck:"+goalId)
    });
    return {
      completed:false,
      action_taken:true,
      evaluation:clone(evaluation),
      proposal:clone(proposal),
      ...applied
    };
  }

  async runAutonomousEpisode(goalId,{
    observe,
    planner,
    max_steps=6,
    max_actions=12,
    max_duration_ms=60000,
    max_stagnant_steps=2,
    min_score_improvement=0.01,
    max_oscillations=2,
    now=()=>Date.now()
  }={}){
    if(typeof observe!=="function")throw new Error("autonomous_observe_required");
    if(typeof planner!=="function")throw new Error("autonomous_planner_required");
    if(max_steps<1||max_actions<0||max_duration_ms<0)throw new Error("invalid_autonomy_budget");

    const started=Number(now());
    const trace=[];
    let actionCount=0;
    let previousScore=null;
    let stagnantSteps=0;
    let oscillations=0;
    const strategies=[strategySignature(this.requireActive(goalId).strategy)];

    const stop=(reason,extra={})=>{
      const ep=this.requireActive(goalId);
      ep.autonomy_stop_reason=reason;
      ep.autonomy_outcome=classifyEpisodeOutcome(reason);
      ep.autonomy_trace=clone(trace);
      ep.autonomy_budget={
        max_steps,max_actions,max_duration_ms,max_stagnant_steps,
        min_score_improvement,max_oscillations
      };
      return {
        completed:false,
        stopped:true,
        stop_reason:reason,
        steps:trace.length,
        actions:actionCount,
        trace:clone(trace),
        runtime:normalizeRuntime(this.runtime),
        outcome:clone(ep.autonomy_outcome),
        episode:clone(ep),
        ...extra
      };
    };

    for(let step=0;step<max_steps;step++){
      const elapsed=Number(now())-started;
      if(elapsed>max_duration_ms)return stop("duration_budget_exceeded",{elapsed_ms:elapsed});
      const remaining=max_actions-actionCount;
      if(remaining<=0)return stop("action_budget_exhausted");

      const observation=await observe({
        goal_id:goalId,
        step,
        runtime:normalizeRuntime(this.runtime),
        episode:clone(this.requireActive(goalId))
      });

      const beforeCommands=this.commandCount();
      const row=await this.recheckGoal(goalId,{
        observation:observation||{},
        turn_id:"auto:"+goalId+":"+String(step+1),
        max_actions:remaining,
        planner:async input=>planner({...input,step,remaining_actions:remaining})
      });
      const afterCommands=this.commandCount();
      const delta=(beforeCommands!=null&&afterCommands!=null)
        ?Math.max(0,afterCommands-beforeCommands)
        :(row.action_taken?expandedPatchCount(row.proposal&&row.proposal.patches||[]):0);
      actionCount+=delta;

      const strategy=strategySignature(this.getEpisode(goalId)&&this.getEpisode(goalId).strategy);
      strategies.push(strategy);
      if(strategies.length>=3){
        const n=strategies.length;
        if(strategies[n-1]===strategies[n-3]&&strategies[n-1]!==strategies[n-2])oscillations++;
      }

      const score=row.evaluation&&typeof row.evaluation.score==="number"?row.evaluation.score:null;
      if(previousScore!=null&&score!=null&&row.action_taken){
        const improvement=score-previousScore;
        stagnantSteps=improvement<min_score_improvement?stagnantSteps+1:0;
      }
      if(score!=null)previousScore=score;

      trace.push({
        step,
        score,
        action_taken:!!row.action_taken,
        actions_used:delta,
        total_actions:actionCount,
        strategy,
        blocked_reason:row.blocked_reason||null,
        completed:!!row.completed,
        deficits:row.evaluation?row.evaluation.deficits.map(x=>x.id):[]
      });

      if(row.completed){
        const ep=this.getEpisode(goalId);
        ep.autonomy_trace=clone(trace);
        ep.autonomy_stop_reason="goal_completed";
        ep.autonomy_outcome=classifyEpisodeOutcome("goal_completed");
        return {
          completed:true,
          stopped:false,
          stop_reason:"goal_completed",
          steps:trace.length,
          actions:actionCount,
          trace:clone(trace),
          outcome:clone(ep.autonomy_outcome),
          runtime:normalizeRuntime(this.runtime),
          episode:clone(ep)
        };
      }
      if(row.blocked_reason)return stop(row.blocked_reason,{last:clone(row)});
      if(oscillations>=max_oscillations)return stop("strategy_oscillation");
      if(stagnantSteps>=max_stagnant_steps)return stop("progress_stalled");
    }
    return stop("step_budget_exhausted");
  }

  commandCount(){
    return Array.isArray(this.driver&&this.driver.commands)?this.driver.commands.length:null;
  }

  captureOwnership(ep,patch,beforeRuntime){
    const slot=patchSlot(patch);
    if(!slot||!patch.target)return;
    const path=slotPath(patch.target,slot);
    const before=currentSlot(beforeRuntime,patch.target,slot);
    if(!ep.agent_owned[path]){
      ep.agent_owned[path]={
        target:clone(patch.target),
        slot,
        baseline_exists:before.exists,
        baseline_value:clone(before.value),
        user_override:false,
        user_value:undefined,
        last_agent_value:undefined
      };
    }else{
      ep.agent_owned[path].user_override=false;
      delete ep.agent_owned[path].user_value;
    }
  }

  refreshAgentValues(ep,patches){
    for(const proposed of patches||[]){
      for(const patch of expandSetPatch(proposed)){
        const slot=patchSlot(patch);
        if(!slot||!patch.target)continue;
        const path=slotPath(patch.target,slot);
        const owned=ep.agent_owned[path];
        if(!owned)continue;
        const now=currentSlot(this.runtime,patch.target,slot);
        owned.last_agent_value=clone(now.value);
      }
    }
  }

  async applyAgentPatches(goalId,patches,{turn_id=null}={}){
    const ep=this.requireActive(goalId);
    const before=normalizeRuntime(this.runtime);
    for(const proposed of patches||[]){
      for(const patch of expandSetPatch(proposed))this.captureOwnership(ep,patch,before);
    }
    const applied=await executePhysicalTurn(
      this.runtime,
      patches,
      this.driver,
      {turn_id:turn_id||("goal:"+goalId)}
    );
    this.runtime=applied.runtime;
    // executePhysicalTurn clones task state, so reacquire the episode reference.
    const live=this.requireActive(goalId);
    // Preserve ownership captured before execution if the physical runtime clone
    // was created before those in-memory fields were visible.
    live.agent_owned=clone(ep.agent_owned);
    this.refreshAgentValues(live,patches);
    return {runtime:normalizeRuntime(this.runtime),receipts:clone(applied.receipts),episode:clone(live)};
  }

  async applyUserPatches(goalId,patches,{turn_id=null}={}){
    const ep=this.requireActive(goalId);
    const applied=await executePhysicalTurn(
      this.runtime,
      patches,
      this.driver,
      {turn_id:turn_id||("user:"+goalId)}
    );
    this.runtime=applied.runtime;
    const live=this.requireActive(goalId);
    for(const proposed of patches||[]){
      for(const patch of expandSetPatch(proposed)){
        const slot=patchSlot(patch);
        if(!slot||!patch.target)continue;
        const path=slotPath(patch.target,slot);
        if(!live.agent_owned[path])continue;
        const now=currentSlot(this.runtime,patch.target,slot);
        live.agent_owned[path].user_override=true;
        live.agent_owned[path].user_value=clone(now.value);
      }
    }
    return {runtime:normalizeRuntime(this.runtime),receipts:clone(applied.receipts),episode:clone(live)};
  }

  async cancelGoal(goalId,{turn_id=null}={}){
    const ep=this.requireActive(goalId);
    const compensation=[];
    for(const owned of Object.values(ep.agent_owned||{})){
      if(owned.user_override)continue;
      if(!owned.baseline_exists)continue;
      const now=currentSlot(this.runtime,owned.target,owned.slot);
      if(now.exists&&eq(now.value,owned.baseline_value))continue;
      compensation.push({
        op:"PATCH_SLOT",
        target:clone(owned.target),
        slot:owned.slot,
        value:clone(owned.baseline_value),
        reason:"goal_cancel_compensation",
        goal_id:goalId
      });
    }

    let receipts=[];
    if(compensation.length){
      const applied=await executePhysicalTurn(
        this.runtime,
        compensation,
        this.driver,
        {turn_id:turn_id||("cancel:"+goalId)}
      );
      this.runtime=applied.runtime;
      receipts=applied.receipts||[];
    }

    const live=this.requireActive(goalId);
    live.status="cancelled";
    live.cancelled=true;
    live.compensation=clone(compensation);
    return {
      runtime:normalizeRuntime(this.runtime),
      compensation:clone(compensation),
      receipts:clone(receipts),
      episode:clone(live)
    };
  }
}

module.exports={HomeGoalRuntime,slotPath,patchSlot,currentSlot,expandedPatchCount,strategySignature,classifyEpisodeOutcome};
