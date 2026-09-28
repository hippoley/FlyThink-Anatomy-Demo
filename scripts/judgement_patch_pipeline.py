#!/usr/bin/env python3
"""Decision→semantic proposal→context composition pipeline contract."""
from context_patch_composer import compose
NON_EXEC={"CLARIFY","BLOCK","NOOP","CANCEL_PENDING","UNDO_EXECUTED"}
def decide_and_compose(judgement,semantic_proposal,context,slot_resolver=None,text=''):
 d=judgement["decision"]
 if d in NON_EXEC:return {"decision":d,"patches":[],"reason":judgement.get("reason")}
 if d!="EXECUTE":raise ValueError("unknown_judgement")
 return compose(semantic_proposal,context,slot_resolver,text)
