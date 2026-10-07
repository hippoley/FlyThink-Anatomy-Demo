#!/usr/bin/env python3
from device_registry import DeviceRegistry,DeviceBinding
from authorized_patch_planner import plan
r=DeviceRegistry([
 DeviceBinding("客厅","空调","default","AWGD-ZA01"),
 DeviceBinding("主卧","空调","default","AWGD-ZA01"),
 DeviceBinding("客厅","灯","default","LIGHT_GROUP"),
 DeviceBinding("客厅","窗户","default","CWDS-CA01"),
])
AUTHORITY_KEY="test-authority-key"
# Valid typed/ranged capabilities.
x=plan(r,["客厅::空调::default","主卧::空调::default"],"temperature",22,authority_key=AUTHORITY_KEY)
assert x["ok"] and len(x["patches"])==2 and all(p["capability"]=="targetTemperature" for p in x["patches"])
assert plan(r,["客厅::灯::default"],"brightness",70,authority_key=AUTHORITY_KEY)["ok"]
assert plan(r,["客厅::窗户::default"],"opening",60,authority_key=AUTHORITY_KEY)["ok"]
# Unsupported semantic slot fails closed.
x=plan(r,["客厅::灯::default"],"temperature",22,authority_key=AUTHORITY_KEY);assert not x["ok"] and x["patches"]==[] and x["rejected"][0]["reason"]=="unsupported_semantic_slot"
# Range violation fails closed.
x=plan(r,["客厅::空调::default"],"temperature",31,authority_key=AUTHORITY_KEY);assert not x["ok"] and x["rejected"][0]["reason"]=="value_out_of_range"
x=plan(r,["客厅::灯::default"],"brightness",101,authority_key=AUTHORITY_KEY);assert not x["ok"]
x=plan(r,["客厅::窗户::default"],"opening",-1,authority_key=AUTHORITY_KEY);assert not x["ok"]
# Unmounted target fails the entire set: no partial writes.
x=plan(r,["客厅::空调::default","书房::空调::default"],"temperature",22,authority_key=AUTHORITY_KEY)
assert not x["ok"] and x["patches"]==[] and "unbound_physical_device" in x["rejected"][0]["reason"]
print("authorized patch planner: PASS")
