#!/usr/bin/env python3
from lexical_operation_evidence import operation_evidence
assert operation_evidence("现在这个再打开")["op"]=="ADD_DEVICE"
assert operation_evidence("把它关掉")["op"]=="CLOSE_DEVICE"
assert operation_evidence("保持空调开启") is None
assert operation_evidence("不要改空调") is None
assert operation_evidence("温度调到24度") is None
print("lexical operation evidence ok")
