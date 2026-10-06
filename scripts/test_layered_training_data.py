#!/usr/bin/env python3
import sys
sys.path.insert(0,"scripts")
from layered_dataset import rows
from layered_training_data import pack,batch_targets
for split in ("train","dev","test"):
 x,ys=pack(rows(split));t=batch_targets(ys)
 assert len(x)==len(ys)>0
 assert x.ndim==2
 assert all(v.shape[0]==len(ys) for v in t["semantic"].values())
 assert all(v.shape[0]==len(ys) for v in t["resolution"].values())
 assert t["judgement"].shape[0]==len(ys)\n assert t["resolution_mask"].shape[0]==len(ys)\n assert all((not y["resolution_applicable"] or len(y["resolution_targets"])!=1) == (not bool(t["resolution_mask"][i])) for i,y in enumerate(ys))
print({"layered_training_data":"PASS"})
