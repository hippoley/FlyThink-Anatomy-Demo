#!/usr/bin/env python3
"""Controlled topology transforms for FlyWire ablation."""
import torch
MODES=("real","degree_rewired","random","disconnected")

def _degree_preserving_swaps(pre,post,gen,attempts):
 pre=pre.clone();post=post.clone();m=len(pre)
 # Swap destinations between two existing directed edges. This preserves every
 # node's in-degree and out-degree exactly; reject self-loops and duplicates.
 edges=set(zip(pre.tolist(),post.tolist()))
 for _ in range(attempts):
  ij=torch.randint(0,m,(2,),generator=gen);i,j=int(ij[0]),int(ij[1])
  if i==j:continue
  a,b=int(pre[i]),int(post[i]);c,d=int(pre[j]),int(post[j])
  if a==d or c==b or (a,d) in edges or (c,b) in edges:continue
  edges.discard((a,b));edges.discard((c,d));edges.add((a,d));edges.add((c,b))
  post[i],post[j]=d,b
 return pre,post

def topology(g,mode,seed):
 if mode not in MODES:raise ValueError(mode)
 e=torch.tensor(g["edges"]);pre=e[:,0].long().clone();post=e[:,1].long().clone();base=e[:,3].float().clone()
 gen=torch.Generator().manual_seed(seed+991)
 if mode=="degree_rewired":pre,post=_degree_preserving_swaps(pre,post,gen,len(pre)*10)
 elif mode=="random":
  n=len(g["root_ids"]);pre=torch.randint(0,n,(len(pre),),generator=gen);post=torch.randint(0,n,(len(post),),generator=gen)
 return pre,post,base

def degree_signature(pre,post,n):
 return torch.bincount(pre,minlength=n),torch.bincount(post,minlength=n)
