#!/usr/bin/env python3
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))

from semantic_capability_map import semantic_capability,validate_value,relative_delta

assert semantic_capability("AWGD-ZA01","temperature")["codes"]==["targetTemperature"]
assert semantic_capability("LIGHT_GROUP","brightness")["codes"]==["brightness"]
assert "motorTargetPosition" in semantic_capability("CWDS-CA01","opening")["codes"]

assert validate_value("AWGD-ZA01","temperature",23)["ok"]
assert not validate_value("AWGD-ZA01","temperature",60)["ok"]
assert validate_value("CWDS-CA01","opening",60)["ok"]
assert not validate_value("LIGHT_GROUP","brightness",0)["ok"]

assert relative_delta("AWGD-ZA01","temperature",-1)==-1
assert relative_delta("LIGHT_GROUP","brightness",1)==10
assert relative_delta("LIGHT_GROUP","brightness",-1)==-10
assert relative_delta("CWDS-CA01","opening",1)==10
assert relative_delta("UNKNOWN","value",1) is None

print("semantic capability map ok")
