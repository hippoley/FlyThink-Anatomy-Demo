#!/usr/bin/env bash
set -euo pipefail

python -m pip install --disable-pip-version-check -r requirements-model-baselines.txt
python tests/test_sklearn_checkpoint_challenger.py

echo "sklearn-checkpoint-challenger-contract PASS"
