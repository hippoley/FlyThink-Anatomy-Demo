#!/usr/bin/env python3
"""Fail-closed planner with deterministic authorization binding."""
import hashlib,json
from semantic_capability_map import validate_value

def parse_key(key):
 p=key.split("::")
 if len(p)!=3:raise ValueError("invalid_target_key")
 return {"area":p[0],"entity":p[1],"instance":p[2]}

def canonical_patch(p):
 return {"capability":p["capability"],"model_id":p["model_id"],"slot":p["slot"],"target":p["target"],"value":p["value"]}

def authorization_digest(patches):
 payload=json.dumps([canonical_patch(p) for p in patches],ensure_ascii=False,sort_keys=True,separators=(",",":"))
 return hashlib.sha256(payload.encode("utf-8")).hexdigest()

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
 if rejected:return {"ok":False,"patches":[],"authorization":None,"rejected":rejected,"reason":"authorized_set_validation_failed"}
 return {"ok":True,"patches":patches,"authorization":{"version":1,"patch_digest":authorization_digest(patches)},"rejected":[]}
