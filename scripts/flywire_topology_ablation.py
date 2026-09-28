#!/usr/bin/env python3
"""Controlled topology transforms for FlyWire ablation."""
import torch

MODES=("real","rewired","random","disconnected")

def topology(g,mode,seed):
 if mode not in MODES: raise ValueError(mode)
 e=torch.tensor(g["edges"])
 pre=e[:,0].long().clone();post=e[:,1].long().clone();base=e[:,3].float().clone()
 gen=torch.Generator().manual_seed(seed+991)
 if mode=="rewired":
  # Preserve source sequence, edge weights and edge count; destroy biological destinations.
  post=post[torch.randperm(len(post),generator=gen)]
 elif mode=="random":
  n=len(g["root_ids"])
  pre=torch.randint(0,n,(len(pre),),generator=gen)
  post=torch.randint(0,n,(len(post),),generator=gen)
 return pre,post,base
