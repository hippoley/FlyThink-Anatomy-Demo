#!/usr/bin/env python3
"""Physical device registry binding runtime instances to immutable Thing Models."""
from dataclasses import dataclass
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
