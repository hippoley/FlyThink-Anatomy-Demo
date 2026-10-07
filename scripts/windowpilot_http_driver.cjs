"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function sleep(ms){return ms>0?new Promise(r=>setTimeout(r,ms)):Promise.resolve()}
function key(t){return t&&[t.area,t.entity,t.instance||"default"].join("::")}
function sameTarget(a,b){return !!a&&!!b&&key(a)===key(b)}

class WindowPilotHttpDriver {
  constructor(options={}){
    if(!options.baseUrl)throw new Error("windowpilot_base_url_required");
    if(!options.target)throw new Error("windowpilot_target_required");
    this.baseUrl=String(options.baseUrl).replace(/\/+$/,"");
    this.target=clone(options.target);
    this.positionSlots=new Set(options.positionSlots||["position","position_pct","window_open_pct","opening"]);
    this.tolerancePct=Number(options.tolerancePct??1);
    this.pollIntervalMs=Number(options.pollIntervalMs??200);
    this.timeoutMs=Number(options.timeoutMs??5000);
    this.defaultOpenPct=options.defaultOpenPct==null?50:Number(options.defaultOpenPct);
    this.maxOpenPct=options.maxOpenPct==null?null:Number(options.maxOpenPct);
    if(this.maxOpenPct!=null&&(!Number.isFinite(this.maxOpenPct)||this.maxOpenPct<0||this.maxOpenPct>100)){
      throw new Error("windowpilot_max_open_pct_invalid");
    }
    this.canonicalPositionSlot=options.canonicalPositionSlot||"opening";
    this.maxPolls=options.maxPolls==null?null:Number(options.maxPolls);
    this.expectedHardwareIdentity=options.expectedHardwareIdentity||null;
    this.requireFreshReadback=options.requireFreshReadback===true;
    this.verifyHardwareIdentityAfterReadback=
      options.verifyHardwareIdentityAfterReadback===true;
    this.stopOnTimeout=options.stopOnTimeout!==false;
    this.requestJson=options.requestJson||null;
    this.commands=[];
  }

  async _request(method,path,payload){
    if(this.requestJson)return await this.requestJson(method,path,payload);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{
      const res=await fetch(this.baseUrl+path,{
        method,
        signal:controller.signal,
        headers:{"Content-Type":"application/json"},
        body:payload==null?undefined:JSON.stringify(payload)
      });
      const raw=await res.text();
      let body={};
      if(raw){
        try{body=JSON.parse(raw)}catch(e){throw new Error("windowpilot_non_json_response:"+path)}
      }
      if(!res.ok)throw new Error("windowpilot_http_"+res.status+":"+path);
      return body;
    } finally {clearTimeout(timer)}
  }

  async readiness(){return await this._request("GET","/api/physical-readiness",null)}
  async state(){return await this._request("GET","/api/state",null)}

  _pct(state){
    const value=state&&state.thing_model&&state.thing_model.window_open_pct;
    const pct=Number(value);
    if(!Number.isFinite(pct)||pct<0||pct>100)throw new Error("windowpilot_invalid_position_readback");
    return pct;
  }

  _tick(state){
    const tick=Number(state&&state.tick);
    return Number.isFinite(tick)?tick:null;
  }

  _identity(readiness){
    return readiness&&readiness.hardware_identity&&
      readiness.hardware_identity.identity_sha256||null;
  }

  _targetPct(patch){
    if(!patch)throw new Error("windowpilot_patch_required");
    if(!sameTarget(patch.target,this.target))throw new Error("windowpilot_wrong_physical_target");

    if(patch.op==="ADD_DEVICE"){
      const slots=patch.slots||{};
      for(const slot of this.positionSlots){
        if(slots[slot]!==undefined){
          const pct=Number(slots[slot]);
          if(!Number.isFinite(pct))throw new Error("windowpilot_position_requires_number");
          return Math.max(0,Math.min(100,pct));
        }
      }
      if(slots.power==="OFF"||slots.power===false||slots.power===0)return 0;
      if(slots.power==="ON"||slots.power===true||slots.power===1){
        return Math.max(0,Math.min(100,this.defaultOpenPct));
      }
      throw new Error("windowpilot_add_device_requires_power_or_position");
    }

    if(patch.op!=="PATCH_SLOT")throw new Error("windowpilot_requires_patch_slot");
    if(this.positionSlots.has(patch.slot)){
      const pct=Number(patch.value);
      if(!Number.isFinite(pct))throw new Error("windowpilot_position_requires_number");
      return Math.max(0,Math.min(100,pct));
    }
    if(patch.slot==="power"){
      if(patch.value==="OFF"||patch.value===false||patch.value===0)return 0;
      if(patch.value==="ON"||patch.value===true||patch.value===1){
        return Math.max(0,Math.min(100,this.defaultOpenPct));
      }
    }
    throw new Error("windowpilot_unsupported_slot:"+String(patch.slot));
  }

  _observation(patch,state,pct){
    const slots={[this.canonicalPositionSlot]:pct};
    if(patch.op==="ADD_DEVICE"||patch.slot==="power"){
      slots.power=pct<=this.tolerancePct?"OFF":"ON";
    }
    return {
      target:clone(this.target),
      exists:true,
      slots,
      evidence:{
        source:"windowpilot:/api/state",
        position_pct:pct,
        tick:state&&state.tick!=null?state.tick:null,
        measured:true
      }
    };
  }

  _blocked(patch,state,pct,reason,readiness){
    const receipt={
      id:"windowpilot:"+(this.commands.length+1),
      status:"blocked",
      reason,
      patch:clone(patch),
      readiness:clone(readiness),
      observation:this._observation(patch,state,pct)
    };
    this.commands.push(receipt);
    return receipt;
  }

  async _safetyStopAfterTimeout(){
    const result={attempted:true,ack:null,error:null};
    try{
      result.ack=clone(await this._request("POST","/api/window/stop",{}));
    }catch(e){
      result.error=String(e&&e.message||e);
    }
    return result;
  }

  async execute(patch){
    const targetPct=this._targetPct(patch);
    const readiness=await this.readiness();
    const before=await this.state();
    const beforePct=this._pct(before);
    const beforeTick=this._tick(before);
    if(this.requireFreshReadback&&beforeTick==null){
      return this._blocked(
        patch,before,beforePct,"state_tick_unavailable_before_actuation",readiness
      );
    }

    if(readiness.physical_write_ready!==true){
      return this._blocked(patch,before,beforePct,"physical_write_not_ready",readiness);
    }

    const identity=this._identity(readiness);
    if(this.expectedHardwareIdentity&&identity!==this.expectedHardwareIdentity){
      return this._blocked(patch,before,beforePct,"hardware_identity_mismatch",readiness);
    }

    if(this.maxOpenPct!=null&&targetPct>this.maxOpenPct){
      return this._blocked(patch,before,beforePct,"target_above_max_open_pct",readiness);
    }

    // Opening requires trustworthy current rain evidence. Closing is allowed
    // even when environmental evidence is degraded because it reduces exposure.
    if(targetPct>beforePct+this.tolerancePct){
      const rainReady=
        readiness.fresh_sensors&&readiness.fresh_sensors.rain===true&&
        readiness.measured_sensors&&readiness.measured_sensors.rain===true&&
        readiness.registry_bound_sensors&&readiness.registry_bound_sensors.rain===true&&
        readiness.site_bound_sensors&&readiness.site_bound_sensors.rain===true;
      if(!rainReady)return this._blocked(patch,before,beforePct,"rain_evidence_not_ready",readiness);
      const tm=before.thing_model||{};
      if(tm.rain_detected===true)return this._blocked(patch,before,beforePct,"rain_detected",readiness);
      if(Number(tm.wind_speed_ms||0)>=10)return this._blocked(patch,before,beforePct,"high_wind",readiness);
    }

    let ack;
    if(targetPct<=this.tolerancePct)ack=await this._request("POST","/api/window/close",{});
    else ack=await this._request("POST","/api/window/open",{target_pct:targetPct});

    if(!ack||ack.ok!==true){
      const current=await this.state();
      const pct=this._pct(current);
      const receipt={
        id:"windowpilot:"+(this.commands.length+1),
        status:"rejected",
        reason:"command_not_acknowledged",
        patch:clone(patch),
        ack:clone(ack),
        observation:this._observation(patch,current,pct)
      };
      this.commands.push(receipt);
      return receipt;
    }

    const started=Date.now();
    let last=before,lastPct=beforePct,polls=0;
    while(Date.now()-started<=this.timeoutMs && (this.maxPolls==null||polls<this.maxPolls)){
      last=await this.state();
      lastPct=this._pct(last);
      polls++;
      const lastTick=this._tick(last);
      const freshEnough=!this.requireFreshReadback||(
        beforeTick!=null&&lastTick!=null&&lastTick>beforeTick
      );
      if(Math.abs(lastPct-targetPct)<=this.tolerancePct&&freshEnough){
        let readinessAfter=null;
        let identityAfter=null;
        if(this.verifyHardwareIdentityAfterReadback){
          readinessAfter=await this.readiness();
          identityAfter=this._identity(readinessAfter);
          if(
            identityAfter!==identity||
            (this.expectedHardwareIdentity&&identityAfter!==this.expectedHardwareIdentity)
          ){
            const receipt={
              id:"windowpilot:"+(this.commands.length+1),
              status:"uncertain",
              reason:"hardware_identity_changed_after_actuation",
              patch:clone(patch),
              ack:clone(ack),
              requested_position_pct:targetPct,
              polls,
              before_tick:beforeTick,
              readiness_before:clone(readiness),
              readiness_after:clone(readinessAfter),
              hardware_identity_before:identity,
              hardware_identity_after:identityAfter,
              observation:this._observation(patch,last,lastPct)
            };
            this.commands.push(receipt);
            return receipt;
          }
        }
        const receipt={
          id:"windowpilot:"+(this.commands.length+1),
          status:"applied",
          patch:clone(patch),
          ack:clone(ack),
          requested_position_pct:targetPct,
          polls,
          before_tick:beforeTick,
          readiness_before:clone(readiness),
          readiness_after:clone(readinessAfter),
          hardware_identity_before:identity,
          hardware_identity_after:identityAfter,
          observation:this._observation(patch,last,lastPct)
        };
        this.commands.push(receipt);
        return receipt;
      }
      if(this.maxPolls!=null&&polls>=this.maxPolls)break;
      await sleep(this.pollIntervalMs);
    }

    let safetyStop={attempted:false,ack:null,error:null};
    if(this.stopOnTimeout){
      safetyStop=await this._safetyStopAfterTimeout();
      try{
        const stopped=await this.state();
        last=stopped;
        lastPct=this._pct(stopped);
      }catch(e){
        safetyStop.readback_error=String(e&&e.message||e);
      }
    }

    const receipt={
      id:"windowpilot:"+(this.commands.length+1),
      status:"timeout",
      reason:"position_not_observed_within_tolerance",
      patch:clone(patch),
      ack:clone(ack),
      requested_position_pct:targetPct,
      polls,
      before_tick:beforeTick,
      readiness_before:clone(readiness),
      hardware_identity_before:identity,
      safety_stop:safetyStop,
      observation:this._observation(patch,last,lastPct)
    };
    this.commands.push(receipt);
    return receipt;
  }
}

module.exports={WindowPilotHttpDriver,sameTarget};
