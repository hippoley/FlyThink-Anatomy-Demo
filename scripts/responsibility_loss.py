#!/usr/bin/env python3
"""Joint responsibility loss with compositional SET supervision."""
import torch
import torch.nn.functional as F
def ce(logits,target):return F.cross_entropy(logits,target)
def joint_loss(outputs,targets,weights=None,masks=None):
    w={"semantic":1.0,"resolution":1.0,"judgement":1.0};w.update(weights or {});masks=masks or {};parts={}
    if "semantic" in targets:parts["semantic"]=sum(ce(outputs["semantic"][k],v) for k,v in targets["semantic"].items())
    if "resolution" in targets:
        one=masks.get("resolution_one",masks.get("resolution"));sett=masks.get("resolution_set")
        r=torch.zeros((),device=outputs["judgement"].device)
        if one is None:
            r=sum(ce(outputs["resolution"][k],targets["resolution"][k]) for k in ("room","entity","slot"))
        elif bool(one.any()):
            r=r+sum(ce(outputs["resolution"][k][one],targets["resolution"][k][one]) for k in ("room","entity","slot"))
        if sett is not None and bool(sett.any()):
            for k in ("membership","room_membership","entity_membership"):
                r=r+F.binary_cross_entropy_with_logits(outputs["resolution"][k][sett],targets["resolution"][k][sett])
            r=r+ce(outputs["resolution"]["slot"][sett],targets["resolution"]["slot"][sett])
        parts["resolution"]=r
    if "judgement" in targets:parts["judgement"]=ce(outputs["judgement"],targets["judgement"])
    total=sum(w[k]*v for k,v in parts.items());return total,parts
