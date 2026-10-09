#!/usr/bin/env python3
import importlib.util,pathlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("fuzzy",ROOT/"scripts/check_benchmark_v3_fuzzy_leakage.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

assert m.canonical_surface("打开客厅空调")=="打开"
assert m.canonical_surface("开启次卧空调机")=="开启"
assert m.canonical_surface("把客厅空调温度调到19")=="把温度调到"
assert m.canonical_surface("把主卧空调温度调到27")=="把温度调到"
assert m.canonical_surface("更正一下，目标不是主卧而是次卧灯，亮度80")=="更正一下目标不是而是亮度"

print("benchmark-v3-fuzzy-canonicalization PASS")
