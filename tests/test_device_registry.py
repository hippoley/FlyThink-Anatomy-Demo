#!/usr/bin/env python3
from device_registry import DeviceRegistry,DeviceBinding
r=DeviceRegistry([DeviceBinding("客厅","空调","default","MODEL_AC_A"),DeviceBinding("主卧","空调","ac2","MODEL_AC_B")])
assert r.resolve({"area":"客厅","entity":"空调"}).model_id=="MODEL_AC_A"
assert r.resolve({"area":"主卧","entity":"空调","instance":"ac2"}).model_id=="MODEL_AC_B"
try:r.resolve({"area":"主卧","entity":"空调"})
except KeyError:pass
else:raise AssertionError("unbound instance must not silently fall back")
try:r.register(DeviceBinding("客厅","空调","default","OTHER"))
except ValueError:pass
else:raise AssertionError("binding conflict must fail")
print({"ok":True,"exact_instance_binding":True,"silent_fallback":False})
