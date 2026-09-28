#!/usr/bin/env python3
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from minimal_state_delta import assert_minimal_delta
b={"devices":{"客厅":{"power":"ON","temperature":24},"主卧":{"power":"OFF","temperature":25}}}
a={"devices":{"客厅":{"power":"ON","temperature":24},"主卧":{"power":"ON","temperature":25}}}
r=assert_minimal_delta(b,a,["devices.主卧.power"]);assert r["drift"]==[]
bad={"devices":{"客厅":{"power":"OFF","temperature":24},"主卧":{"power":"ON","temperature":25}}}
try:assert_minimal_delta(b,bad,["devices.主卧.power"]);raise AssertionError("drift not detected")
except AssertionError as e:assert "state drift" in str(e)
print("minimal state delta invariant ok")
