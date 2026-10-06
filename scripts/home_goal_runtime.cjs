"use strict";

const {
  deviceKey,
  normalizeRuntime,
  expandSetPatch
}=require("./whole_home_patch_contract.cjs");
const {executePhysicalTurn}=require("./physical_runtime.cjs");

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

module.exports={HomeGoalRuntime,slotPath,patchSlot,currentSlot};
