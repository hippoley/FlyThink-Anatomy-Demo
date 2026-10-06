#!/usr/bin/env python3
"""Joint loss plumbing with responsibility masks."""
import torch
import torch.nn.functional as F
def ce(logits,target):return F.cross_entropy(logits,target)
def joint_loss(outputs,targets,weights=None,masks=None):
 w={"semantic":1.0,"resolution":1.0,"judgement":1.0};w.update(weights or {});masks=masks or {};parts={}
 if "semantic" in targets:
  parts["semantic"]=sum(ce(outputs["semantic"][k],v) for k,v in targets["semantic"].items())
 if "resolution" in targets:
  mask=masks.get("resolution")
  if mask is None:parts["resolution"]=sum(ce(outputs["resolution"][k],v) for k,v in targets["resolution"].items())
  elif bool(mask.any()):parts["resolution"]=sum(ce(outputs["resolution"][k][mask],v[mask]) for k,v in targets["resolution"].items())
  else:parts["resolution"]=torch.zeros((),device=outputs["judgement"].device)
 if "judgement" in targets:parts["judgement"]=ce(outputs["judgement"],targets["judgement"])
 total=sum(w[k]*v for k,v in parts.items());return total,parts
