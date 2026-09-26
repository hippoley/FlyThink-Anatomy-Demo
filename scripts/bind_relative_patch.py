#!/usr/bin/env python3
"""Deterministic binding gate for relative semantic patches.
Neural inference decides relative intent/direction; explicit slot evidence and
focused target context constrain target/slot before Thing Model grounding.
"""
SLOT_CUES={
 "temperature":("温度","度","冷一点","热一点"),
 "opening":("开度","开大","开小","关小","放大","收一点"),
}
CONTINUOUS_BY_ENTITY={"空调":("temperature",),"窗户":("opening",)}

def bind_relative(text, proposal, context):
    if proposal.get("op")!="PATCH_RELATIVE": return proposal
    out=dict(proposal)
    focus=context.get("focused_target")
    if focus: out["target"]=focus
    matched=[]
    for slot,cues in SLOT_CUES.items():
        for cue in cues:
            if cue in text: matched.append((len(cue),slot,cue))
    if matched:
        longest=max(x[0] for x in matched)
        hits={slot for n,slot,_ in matched if n==longest}
        if len(hits)==1: out["slot"]=next(iter(hits))
        else: raise ValueError("ambiguous_relative_slot")
    elif focus:
        candidates=CONTINUOUS_BY_ENTITY.get(focus.get("entity"),())
        if len(candidates)==1: out["slot"]=candidates[0]
        else: raise ValueError("relative_slot_requires_clarification")
    else:
        raise ValueError("relative_target_requires_clarification")
    return out
