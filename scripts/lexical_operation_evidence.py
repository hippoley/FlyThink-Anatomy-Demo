#!/usr/bin/env python3
"""High-precision lexical evidence. It may override a neural op only for unambiguous actuator verbs."""
OPEN=("打开","开启","开起来","再打开","重新开启","启动")
CLOSE=("关掉","关闭","关上","停掉")
PROTECT=("保持","不要改","别改","维持")
def operation_evidence(text):
 t=text or ""
 if any(x in t for x in PROTECT):return None
 close=any(x in t for x in CLOSE);open_=any(x in t for x in OPEN)
 if close and not open_:return {"op":"CLOSE_DEVICE","source":"lexical_actuator","confidence":1.0}
 if open_ and not close:return {"op":"ADD_DEVICE","source":"lexical_actuator","confidence":1.0}
 return None
