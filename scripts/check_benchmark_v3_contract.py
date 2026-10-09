#!/usr/bin/env python3
"""Fast executable contract for Benchmark V3 generation + validation."""
import pathlib,subprocess,sys,tempfile

root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="flythink-bench-v3-") as td:
 out=pathlib.Path(td)/"v3.json"
 subprocess.run([sys.executable,str(root/"scripts/generate_long_trajectory_benchmark_v3.py"),
   "--count","180","--out",str(out)],check=True,cwd=root)
 subprocess.run([sys.executable,str(root/"scripts/validate_long_trajectory_benchmark_v3.py"),
   str(out)],check=True,cwd=root)
print("benchmark-v3-contract PASS")
