#!/usr/bin/env bash
set -euo pipefail

python -m pip install --disable-pip-version-check -r requirements-benchmark.txt

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

python scripts/generate_long_trajectory_benchmark_v3.py   --count 180 --release-id 2026-10-r2   --out "$tmpdir/benchmark-v3-r2.json"

python scripts/check_benchmark_v3_fuzzy_leakage.py   "$tmpdir/benchmark-v3-r2.json"   --threshold 92   --report "$tmpdir/fuzzy-leakage.json"

python tests/test_benchmark_v3_properties.py

echo "benchmark-v3-external-quality PASS"
