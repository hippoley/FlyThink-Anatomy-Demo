import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))

from lexical_operation_evidence import operation_evidence,safe_block_override

assert operation_evidence("现在这个再打开")["op"]=="ADD_DEVICE"
assert operation_evidence("把它关掉")["op"]=="CLOSE_DEVICE"
assert operation_evidence("保持空调开启") is None
assert operation_evidence("不要改空调") is None

assert operation_evidence("温度调到24度")["op"]=="PATCH_SLOT"
assert operation_evidence("主卧窗户开到80%")["op"]=="PATCH_SLOT"
assert operation_evidence("客厅灯亮度调到60%")["op"]=="PATCH_SLOT"

neg=operation_evidence("再低一点")
assert neg["op"]=="PATCH_RELATIVE" and neg["direction"]=="NEG"
pos=operation_evidence("再亮一点")
assert pos["op"]=="PATCH_RELATIVE" and pos["direction"]=="POS"

ctx={"focused_target":{"area":"客厅","entity":"窗","instance":"default"},"protected_paths":[]}
assert safe_block_override(operation_evidence("再开大一点"),ctx,{"rain":False}) is True
assert safe_block_override(operation_evidence("再开大一点"),ctx,{"rain":True}) is False
assert safe_block_override(operation_evidence("再开大一点"),{**ctx,"protected_paths":["客厅::窗::default::slots::opening"]},{}) is False
assert safe_block_override(operation_evidence("再低一点"),{}, {}) is False

print("lexical operation evidence ok")
