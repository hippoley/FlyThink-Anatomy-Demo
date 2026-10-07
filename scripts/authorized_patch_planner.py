#!/usr/bin/env python3
"""Fail-closed planner from authorized target keys to capability-validated minimal patches."""
from semantic_capability_map import validate_value
def parse_key(key):
 p=key.split("::")
 if len(p)!=3:raise ValueError("invalid_target_key")
 return {"area":p[0],"entity":p[1],"instance":p[2]}
def plan(registry,target_keys,slot,value):
 patches=[];rejected=[]
 for key in target_keys:
  try:b=registry.resolve(parse_key(key))
  except (KeyError,ValueError) as e:
   rejected.append({"target":key,"reason":str(e)});continue
  v=validate_value(b.model_id,slot,value)
  if not v.get("ok"):
   rejected.append({"target":key,"model_id":b.model_id,"slot":slot,"reason":v["reason"]});continue
  patches.append({"target":key,"model_id":b.model_id,"slot":slot,"capability":v["capability"]["codes"][0],"value":value})
 # Atomic fail-closed policy: a set request is not partially committed.
 if rejected:return {"ok":False,"patches":[],"rejected":rejected,"reason":"authorized_set_validation_failed"}
 return {"ok":True,"patches":patches,"rejected":[]}
