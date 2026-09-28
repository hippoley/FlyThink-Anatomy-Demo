#!/usr/bin/env python3
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from context_slot_resolver import cue_slot

assert cue_slot("客厅灯亮度调到60%")=="brightness"
assert cue_slot("再亮一点")=="brightness"
assert cue_slot("主卧窗户开度调到60%")=="opening"
assert cue_slot("主卧窗户开到80%")=="opening"
assert cue_slot("客厅窗户开到20%")=="opening"
assert cue_slot("温度调到23度")=="temperature"

print("target-aware slot cues ok")
