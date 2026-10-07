"use strict";

const {buildCanaryPlan,evaluateCanary}=require("./pi_home_policy_canary.cjs");
const {applyCanaryDecision}=require("./pi_home_canary_rollback.cjs");

function journalRef(record){
  return record&&record.hash?("journal://"+record.hash):null;
}

class PolicyLifecycleOrchestrator{
  constructor({registry,journal}={}){
    if(!registry||typeof registry.promote!=="function")throw new Error("policy_registry_required");
    if(!journal||typeof journal.append!=="function")throw new Error("evidence_journal_required");
    this.registry=registry;
    this.journal=journal;
  }

  applyPromotionGate(gate){
    if(!gate||gate.schema_version!=="pi-home-promotion-gate-v1"){
      throw new Error("promotion_gate_required");
    }
    const gateEvent=this.journal.append({
      type:"PROMOTION_GATE",
      actor:gate.approval&&gate.approval.actor||"system",
      refs:{candidate_policy_id:gate.candidate_policy_id||null},
      payload:gate
    });

    if(gate.decision!=="POLICY_PROMOTION_AUTHORIZED"||gate.policy_switch_authorized!==true){
      return {
        changed:false,
        gate,
        gate_event:gateEvent,
        active_policy:this.registry.active(),
        device_execution_authorized:false
      };
    }

    const promoted=this.registry.promote(gate,{evidence_ref:journalRef(gateEvent)});
    const promotionEvent=this.journal.append({
      type:"POLICY_PROMOTION",
      actor:gate.approval&&gate.approval.actor||"system",
      refs:{
        evidence:journalRef(gateEvent),
        from:promoted.previous_policy_id||null,
        to:promoted.active_policy_id
      },
      payload:promoted
    });
    return {
      changed:promoted.changed,
      gate,
      gate_event:gateEvent,
      promotion:promoted,
      promotion_event:promotionEvent,
      active_policy:this.registry.active(),
      device_execution_authorized:false
    };
  }

  applyReceiptBackedPromotionGate(gate,{
    receipt,
    receipt_context
  }={}){
    if(!gate||gate.schema_version!=="pi-home-promotion-gate-v1"){
      throw new Error("promotion_gate_required");
    }
    if(!receipt||receipt.schema_version!=="pi-home-evidence-decision-receipt-v1"){
      throw new Error("evidence_decision_receipt_required");
    }
    if(receipt.device_execution_authorized!==false){
      throw new Error("evidence_decision_receipt_must_not_authorize_device_execution");
    }
    if(receipt.trusted_for_generalization_claim!==true){
      throw new Error("trusted_generalization_receipt_required_for_promotion");
    }
    const gateReceiptDigest=
      gate.evidence_summary&&gate.evidence_summary.decision_receipt_digest;
    if(gateReceiptDigest!==receipt.receipt_digest){
      throw new Error("promotion_gate_receipt_digest_mismatch");
    }

    const receiptWrite=this.journal.appendDecisionReceipt(
      receipt,
      receipt_context||{}
    );
    const receiptEvent=receiptWrite.record;
    const receiptEvidenceRef=journalRef(receiptEvent);

    const gateEvent=this.journal.append({
      type:"PROMOTION_GATE",
      actor:gate.approval&&gate.approval.actor||"system",
      refs:{
        candidate_policy_id:gate.candidate_policy_id||null,
        decision_receipt:receiptEvidenceRef,
        decision_receipt_digest:receipt.receipt_digest
      },
      payload:gate
    });

    if(gate.decision!=="POLICY_PROMOTION_AUTHORIZED"||gate.policy_switch_authorized!==true){
      return {
        changed:false,
        gate,
        receipt_event:receiptEvent,
        receipt_verification:receiptWrite.verification,
        gate_event:gateEvent,
        active_policy:this.registry.active(),
        evidence_ref:receiptEvidenceRef,
        device_execution_authorized:false
      };
    }

    const promoted=this.registry.promote(gate,{evidence_ref:receiptEvidenceRef});
    const promotionEvent=this.journal.append({
      type:"POLICY_PROMOTION",
      actor:gate.approval&&gate.approval.actor||"system",
      refs:{
        evidence:receiptEvidenceRef,
        promotion_gate:journalRef(gateEvent),
        decision_receipt_digest:receipt.receipt_digest,
        from:promoted.previous_policy_id||null,
        to:promoted.active_policy_id
      },
      payload:promoted
    });
    return {
      changed:promoted.changed,
      gate,
      receipt_event:receiptEvent,
      receipt_verification:receiptWrite.verification,
      gate_event:gateEvent,
      promotion:promoted,
      promotion_event:promotionEvent,
      evidence_ref:receiptEvidenceRef,
      active_policy:this.registry.active(),
      device_execution_authorized:false
    };
  }

  createCanaryPlan(options={}){
    const plan=buildCanaryPlan({
      registry_snapshot:this.registry.snapshot(),
      ...options
    });
    const event=this.journal.append({
      type:"CANARY_PLAN",
      actor:"system",
      refs:{
        candidate_policy_id:plan.candidate_policy_id,
        control_policy_id:plan.control_policy_id
      },
      payload:plan
    });
    return {plan,event};
  }

  evaluateCanary(plan,observations=[]){
    const evaluation=evaluateCanary(plan,observations);
    const event=this.journal.append({
      type:"CANARY_EVALUATION",
      actor:"system",
      refs:{
        candidate_policy_id:plan.candidate_policy_id,
        control_policy_id:plan.control_policy_id
      },
      payload:evaluation
    });
    return {evaluation,event};
  }

  applyCanaryEvaluation(evaluation,{actor}={}){
    const evidenceEvent=this.journal.records[this.journal.records.length-1];
    if(!evidenceEvent||evidenceEvent.type!=="CANARY_EVALUATION"){
      throw new Error("latest_journal_event_not_canary_evaluation");
    }
    if(JSON.stringify(evidenceEvent.payload)!==JSON.stringify(evaluation)){
      throw new Error("canary_evaluation_evidence_mismatch");
    }
    const result=applyCanaryDecision({
      registry:this.registry,
      canary_evaluation:evaluation,
      actor,
      evidence_ref:journalRef(evidenceEvent)
    });
    if(!result.changed){
      return {
        ...result,
        evidence_ref:journalRef(evidenceEvent),
        device_execution_authorized:false
      };
    }
    const rollbackEvent=this.journal.append({
      type:"POLICY_ROLLBACK",
      actor,
      refs:{
        evidence:journalRef(evidenceEvent),
        from:result.rollback&&result.rollback.rolled_back_policy_id||null,
        to:result.active_policy_id
      },
      payload:result
    });
    return {
      ...result,
      rollback_event:rollbackEvent,
      evidence_ref:journalRef(evidenceEvent),
      device_execution_authorized:false
    };
  }
}

module.exports={PolicyLifecycleOrchestrator,journalRef};
