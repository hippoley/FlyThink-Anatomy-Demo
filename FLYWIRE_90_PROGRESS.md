# FlyWire 90% target: v15–v18 experiment record

Status: **not ready to replace the default model**. The 90% gate fails.

All four candidates were trained locally on the verified FlyWire-derived subgraph: 512 neurons and 9,692 edges. This is not whole-brain training. The browser demo is not running these Python checkpoints.

## Results

The historical v5 regression has 80 turns. It has been inspected during development and must not be called a fresh blind test. Development data changed after v14, so only the unchanged v5 regression provides a same-suite comparison.

| Model | Development Delta exact | v5 Delta exact | v5 raw network Delta exact | v5 predicted-state accuracy |
| --- | ---: | ---: | ---: | ---: |
| v14 historical report | not comparable | 81.25% | not recorded | not recorded |
| v15 | 88.39% | 71.25% | 70.00% | 77.50% |
| v16 | 79.50% | 61.25% | 56.25% | 53.75% |
| v17 | 91.17% | 83.75% | 80.00% | 86.25% |
| v18 | 92.06% | 81.25% | 78.75% | 73.75% |

v18 was selected at epoch 1 using development metrics only. All 13 development metrics exceed 90%; the minimum is retraction Delta exact at 91.08%. This is model selection evidence, not an external generalization claim.

## New shorthand probe

The 66-turn v6 probe includes `关掉`, `调到30%`, local retraction, pause/resume, multi-room operations and explicit clearing. It was frozen after the training corpus, before checkpoint evaluation; no exact training text overlaps were found. It is authored in this project, uses repeated templates across six room/object combinations, and is not independently blinded.

| v18 evaluation | Result |
| --- | ---: |
| Raw network Delta exact | 86.36% |
| Delta exact after reference resolution | 92.42% |
| Predicted-state sequential rollout accuracy | 93.94% |
| Raw coreference target accuracy | 83.33% |

Reference resolution improves results, so its scores are reported separately. Both v5 and v6 fail the full 90% gate. On v5, v18 also regresses in OOD routing versus v14; no default checkpoint was promoted.

## Changes and remaining failures

- Removed randomly selected targets for implicit references when no focus exists.
- Train cross-slot revisions; reference resolution preserves the predicted new slot for add/revise.
- Split same-object commands in different rooms into separate neural input channels.
- Added optional training paraphrases and in-sentence corrections; reduced the candidate learning rate to 0.001.
- Retain the checkpoint with the strongest minimum development metric. Later epochs overfit.
- Evaluate raw network output, resolved output and autoregressive committed-state rollout separately.
- Export original failed predictions, context, model hash and expected state into `artifacts/flywire-delta-v18/failure-library.jsonl`. Records are not automatically approved for training.

Remaining errors include add versus revise, implicit coreference in raw neural output, global versus local cancellation, pause/resume and unseen OOD wording. Next experiments should regularize the model and add reviewed contrastive training pairs while retaining frozen evaluation sets.

## Reproduce

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-flywire.txt
python scripts/train_flywire_delta.py --modes real --epochs 15 --augment --learning-rate .001 --out artifacts/flywire-delta-v18
python scripts/evaluate_flywire_delta_suite.py --suite v5 --checkpoint artifacts/flywire-delta-v18/real.pt --out artifacts/flywire-delta-v18/regression-v5.json --truth historical_regression_not_blind
python scripts/evaluate_flywire_delta_suite.py --suite v6 --checkpoint artifacts/flywire-delta-v18/real.pt --out artifacts/flywire-delta-v18/probe-v6.json --truth project_authored_shorthand_probe
python scripts/accuracy_gate.py artifacts/flywire-delta-v18/probe-v6.json
```

The final command is expected to exit 1 for this candidate. The manual `FlyWire bounded 90 percent gate` workflow retains evidence even when the gate fails. Large checkpoint files are delivered in the accompanying training archive rather than committed to Git.

Checkpoint SHA-256: `6b05cf9ee969dc111ab29e1f4840ee5fabcf6f5a9ef9290be8d7ae7fa29d97c0`. Restore verification passed.

## Scope

Three rooms, two object classes, two properties, four non-empty values and at most two mutations per turn. The 46 Thing Models remain the fixed browser capability boundary, but this neural benchmark does not cover all 46. Ambiguity clarification is not a model output class yet. OOD routing is evaluated; OOD generation, whole-brain training, new matched topology controls and live device execution are not completed here. Passing a bounded gate would not establish a 90% success rate for all household scenarios.
