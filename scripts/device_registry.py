#!/usr/bin/env python3
"""Physical device registry with deterministic snapshot identity."""
from dataclasses import dataclass
import hashlib,json

@dataclass(frozen=True)
class DeviceBinding:
 area:str;entity:str;instance:str;model_id:str
 @property
 def key(self):return f"{self.area}::{self.entity}::{self.instance}"

class DeviceRegistry:
 def __init__(self,bindings=()):self._d={b.key:b for b in bindings}
 def register(self,b):
  if b.key in self._d and self._d[b.key]!=b:raise ValueError("device_binding_conflict")
  self._d[b.key]=b
 def resolve(self,target):
  k=f'{target["area"]}::{target["entity"]}::{target.get("instance","default")}'
  if k not in self._d:raise KeyError("unbound_physical_device:"+k)
  return self._d[k]
 def context(self):return {k:{"model_id":v.model_id} for k,v in self._d.items()}
 def snapshot_digest(self):
  payload=json.dumps(self.context(),ensure_ascii=False,sort_keys=True,separators=(",",":"))
  return hashlib.sha256(payload.encode("utf-8")).hexdigest()
