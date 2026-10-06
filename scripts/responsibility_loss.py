#!/usr/bin/env python3
"""Joint loss plumbing. Each responsibility can be enabled independently for ablation."""
import torch.nn.functional as F
def ce(logits,target):return F.cross_entropy(logits,target)
def joint_loss(outputs,targets,weights=None):
 w={"semantic":1.0,"resolution":1.0,"judgement":1.0};w.update(weights or {})
 parts={}
 if "semantic" in targets:
  parts["semantic"]=sum(ce(outputs["semantic"][k],v) for k,v in targets["semantic"].items())
 if "resolution" in targets:
  parts["resolution"]=sum(ce(outputs["resolution"][k],v) for k,v in targets["resolution"].items())
 if "judgement" in targets:parts["judgement"]=ce(outputs["judgement"],targets["judgement"])
 total=sum(w[k]*v for k,v in parts.items())
 return total,parts
