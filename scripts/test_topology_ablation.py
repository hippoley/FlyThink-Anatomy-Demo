#!/usr/bin/env python3
"""Fail-fast sanity checks for topology ablations."""
import json,sys,torch
sys.path.insert(0,"scripts")
from flywire_topology_ablation import topology,degree_signature
g=json.load(open("artifacts/flywire/connectome.json"));n=len(g["root_ids"])
rp,rq,_=topology(g,"real",2783);dp,dq,_=topology(g,"degree_rewired",2783);xp,xq,_=topology(g,"random",2783)
ri,ro=degree_signature(rp,rq,n);di,do=degree_signature(dp,dq,n);xi,xo=degree_signature(xp,xq,n)
assert torch.equal(ri,di) and torch.equal(ro,do), "degree_rewired must preserve exact in/out degree"
assert not torch.equal(rq,dq), "degree_rewired must actually change topology"
assert len(rp)==len(dp)==len(xp), "edge count mismatch"
print(json.dumps({"nodes":n,"edges":len(rp),"degree_rewired_exact_degree_preserved":True,"rewired_edges_changed":int((rq!=dq).sum()),"random_degree_equal":bool(torch.equal(ri,xi) and torch.equal(ro,xo))}))
