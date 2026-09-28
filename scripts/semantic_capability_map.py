#!/usr/bin/env python3
"""Canonical semantic slots mapped to immutable Thing Model capability codes."""
CANONICAL={
 "AWGD-ZA01":{
  "power":{"codes":["power"],"type":"bool"},
  "temperature":{"codes":["targetTemperature"],"type":"number","min":16,"max":30,"relative_step":1},
  "mode":{"codes":["mode"],"type":"enum"},
 },
 "LIGHT_GROUP":{
  "power":{"codes":["power"],"type":"bool"},
  "brightness":{"codes":["brightness"],"type":"number","min":1,"max":100,"relative_step":10},
 },
 "CWDS-CA01":{
  "power":{"codes":["onOff"],"type":"bool"},
  "opening":{"codes":["motorTargetPosition","motorTargetPosition_1"],"type":"number","min":0,"max":100,"relative_step":10},
  "motor_control":{"codes":["motorControl","motorControl_1"],"type":"enum"},
 }
}

def semantic_capability(model_id,slot):
 return CANONICAL.get(model_id,{}).get(slot)

def validate_value(model_id,slot,value):
 c=semantic_capability(model_id,slot)
 if not c:return {"ok":False,"reason":"unsupported_semantic_slot"}
 if c["type"]=="number":
  if not isinstance(value,(int,float)):return {"ok":False,"reason":"numeric_value_required"}
  if value<c.get("min",value) or value>c.get("max",value):return {"ok":False,"reason":"value_out_of_range","min":c.get("min"),"max":c.get("max")}
 return {"ok":True,"capability":c}

def relative_delta(model_id,slot,direction_or_delta):
 """Map linguistic +/- direction to a device-semantic relative step."""
 c=semantic_capability(model_id,slot)
 if not c or c.get("type")!="number":
  return None
 raw=float(direction_or_delta or 0)
 if raw==0:return 0
 sign=-1 if raw<0 else 1
 return sign*c.get("relative_step",1)
