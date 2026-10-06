"use strict";

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

class PolicyRegistry{
  constructor({policies=[],active_policy_id=null}={}){
    this.policies={};
    this.history=[];
    for(const p of policies||[])this.register(p);
    if(active_policy_id){
      if(!this.policies[active_policy_id])throw new Error("active_policy_not_registered:"+active_policy_id);
      this.active_policy_id=active_policy_id;
      for(const [id,policy] of Object.entries(this.policies)){
        if(id===active_policy_id)policy.status="active";
        else if(policy.status==="active")policy.status="inactive";
      }
    }else{
      const declared=Object.values(this.policies).filter(x=>x.status==="active");
      if(declared.length>1)throw new Error("multiple_active_policies_declared");
      this.active_policy_id=declared.length===1?declared[0].id:null;
    }
  }

  register({id,artifact_ref=null,metadata=null,status="candidate"}={}){
    if(!id)throw new Error("policy_id_required");
    if(this.policies[id])throw new Error("policy_already_registered:"+id);
    this.policies[id]={
      id,
      artifact_ref,
      metadata:clone(metadata),
      status
    };
    return clone(this.policies[id]);
  }

  get(id){return this.policies[id]?clone(this.policies[id]):null}
  active(){return this.active_policy_id?this.get(this.active_policy_id):null}

  promote(gate,{evidence_ref=null}={}){
    if(!gate||gate.schema_version!=="pi-home-promotion-gate-v1"){
      throw new Error("promotion_gate_required");
    }
    if(gate.decision!=="POLICY_PROMOTION_AUTHORIZED"||gate.policy_switch_authorized!==true){
      throw new Error("policy_promotion_not_authorized");
    }
    const candidateId=gate.candidate_policy_id;
    if(!candidateId)throw new Error("candidate_policy_id_required");
    const candidate=this.policies[candidateId];
    if(!candidate)throw new Error("candidate_policy_not_registered:"+candidateId);

    const previousId=this.active_policy_id;
    if(previousId===candidateId){
      return {
        changed:false,
        active_policy_id:candidateId,
        reason:"candidate_already_active",
        device_execution_authorized:false
      };
    }

    if(previousId&&this.policies[previousId])this.policies[previousId].status="inactive";
    candidate.status="active";
    this.active_policy_id=candidateId;

    const event={
      type:"PROMOTION",
      sequence:this.history.length+1,
      from:previousId,
      to:candidateId,
      approval:clone(gate.approval||null),
      evidence_ref,
      evidence_summary:clone(gate.evidence_summary||null)
    };
    this.history.push(event);
    return {
      changed:true,
      active_policy_id:candidateId,
      previous_policy_id:previousId,
      event:clone(event),
      device_execution_authorized:false
    };
  }

  rollback({actor,reason,evidence_ref=null}={}){
    if(typeof actor!=="string"||!actor.trim())throw new Error("rollback_actor_required");
    if(typeof reason!=="string"||!reason.trim())throw new Error("rollback_reason_required");

    const promotion=[...this.history].reverse().find(x=>
      x.type==="PROMOTION"&&x.to===this.active_policy_id&&!x.rolled_back
    );
    if(!promotion)throw new Error("rollback_target_not_found");
    if(!promotion.from||!this.policies[promotion.from])throw new Error("rollback_previous_policy_unavailable");

    const from=this.active_policy_id;
    const to=promotion.from;
    this.policies[from].status="rolled_back";
    this.policies[to].status="active";
    this.active_policy_id=to;
    promotion.rolled_back=true;

    const event={
      type:"ROLLBACK",
      sequence:this.history.length+1,
      from,
      to,
      actor:actor.trim(),
      reason:reason.trim(),
      evidence_ref
    };
    this.history.push(event);
    return {
      changed:true,
      active_policy_id:to,
      rolled_back_policy_id:from,
      event:clone(event),
      device_execution_authorized:false
    };
  }

  snapshot(){
    return {
      schema_version:"pi-home-policy-registry-v1",
      active_policy_id:this.active_policy_id,
      policies:clone(this.policies),
      history:clone(this.history)
    };
  }
}

module.exports={PolicyRegistry};
