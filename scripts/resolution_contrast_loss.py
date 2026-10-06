#!/usr/bin/env python3
"""Resolver contrast: same/similar context-conditioned examples separate by selected target."""
import torch
import torch.nn.functional as F
def target_signature(y):
 return tuple(tuple(sorted(t.items())) for t in y["resolution_targets"])
def contrastive_resolution_loss(z,ys,margin=1.0):
 idx=[i for i,y in enumerate(ys) if y.get("resolution_applicable")]
 if len(idx)<2:return z.sum()*0
 loss=z.sum()*0;n=0
 for ai,i in enumerate(idx):
  for j in idx[ai+1:]:
   same=target_signature(ys[i])==target_signature(ys[j])
   d=F.pairwise_distance(z[i:i+1],z[j:j+1]).mean()
   loss=loss+(d*d if same else F.relu(margin-d)**2);n+=1
 return loss/max(n,1)
