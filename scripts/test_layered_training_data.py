#!/usr/bin/env python3
import sys
sys.path.insert(0,"scripts")
from layered_dataset import rows
from layered_training_data import pack,batch_targets
for split in ("train","dev","test"):
 x,ys=pack(rows(split));t=batch_targets(ys)
 assert len(x)==len(ys)>0 and x.ndim==2
 assert all(v.shape[0]==len(ys) for v in t["semantic"].values())
 assert all(v.shape[0]==len(ys) for v in t["resolution"].items() if False)
 assert t["judgement"].shape[0]==len(ys)
 assert t["resolution_one_mask"].shape[0]==len(ys)
 assert t["resolution_set_mask"].shape[0]==len(ys)
 assert not bool((t["resolution_one_mask"] & t["resolution_set_mask"]).any())
 for i,y in enumerate(ys):
  assert bool(t["resolution_one_mask"][i]) == bool(y["resolution_one"])
  assert bool(t["resolution_set_mask"][i]) == bool(y["resolution_set"])
print({"layered_training_data":"PASS","one_set_masks":"PASS"})
