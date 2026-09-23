# Real FlyWire direct GraphDelta training

This experiment trains a local connectome-constrained rate RNN to predict the
requested mutation directly:

`operation + count + reference mode + node + slot + value`

For two-intent turns, the network predicts a second independent
`node + slot + value`. The model input is the current utterance plus the
pre-commit persistent state tree. It does not receive the correct target,
slot, value, focus or operation as input.

## Verified biological source and bounded model

- FlyWire / Codex FAFB v783 connection table SHA-256:
  `445f996bf6c4b1803b9ba186189138a3061ff8623aa94c0abcf38af30a5bd48b`
- Deterministic induced subgraph: 512 real root IDs and 9,692 directed edges.
- Checked graph artifact SHA-256:
  `73d64a3c9d32fc38b98741fb345b34efd3a678db86f3f195e70e296ec4a7d9d2`
- Trainable internal edge gains are attached only to those verified edges.
- Three recurrent pathways use the same graph: whole utterance, first clause
  and second clause. Separate heads read the operation/reference, count, and
  two node-slot-value tuples.

This is a **512-neuron subgraph rate model**, not full-brain training, a
biophysical spiking reconstruction, or evidence that fruit-fly neurons
understand Chinese.

## State and reference semantics

The network predicts one of four reference modes: no reference, explicit
target, focus coreference, or explicitly named target. A deterministic pointer
resolver then binds focus coreference to the active state-tree node. Named
retraction is accepted only when the named room/object has one unambiguous
active slot.

Successful deltas are committed to a persistent tree. Unmentioned branches do
not disappear. `retain` makes no mutation. Scoped `retract` deletes only its
resolved target. Full `clear` additionally requires explicit all-scope wording
at the runtime gate. OOD requests are mounted as pending text; no generator is
implemented in this experiment.

## v14 development result

The deterministic corpus contains 9,000 training turns, 1,800 turns using
different development templates, and a 24-turn regression set. The checkpoint
was selected at epoch 21 using only the development set.

| Metric | Development | Regression |
|---|---:|---:|
| Operation | 91.89% | 100.00% |
| Reference mode | 93.28% | 95.83% |
| Target tuple | 96.07% | 100.00% |
| Room | 98.72% | 100.00% |
| Object | 99.07% | 100.00% |
| Property / slot | 98.00% | 100.00% |
| Value | 99.90% | 100.00% |
| Complete Delta | 86.28% | 100.00% |
| Coreference target | 97.50% | 100.00% |
| Retraction complete Delta | 80.85% | 100.00% |
| Two-intent complete Delta | 89.43% | 100.00% |
| OOD routing | 100.00% | 100.00% |
| Count | 97.56% | 100.00% |

The development suite was used for checkpoint selection and must not be called
an untouched test set.

## Post-freeze blind-v5 result

After v14 was frozen, an 80-turn suite with new exact utterances was authored
and evaluated once. It was not used for training or checkpoint selection.

| Metric | Blind v5 |
|---|---:|
| Operation | 87.50% |
| Reference mode | 82.50% |
| Target tuple | 98.31% |
| Room | 100.00% |
| Object | 98.31% |
| Property / slot | 100.00% |
| Value | 97.37% |
| Complete Delta | 81.25% |
| Coreference target | 100.00% |
| Retraction complete Delta | 88.89% |
| Two-intent complete Delta | 85.71% |
| OOD routing | 100.00% |
| Count | 91.25% |

This meets the bounded target of every listed line at or above 80%. The sample
is still small and synthetic. v5 becomes a regression suite after this one-shot
evaluation; future tuning requires another post-freeze suite.

## Matched topology controls

All modes use the same architecture, corpus, seed, optimizer, 30 epochs and
development-only checkpoint rule. Frozen keeps the verified edges but does not
train their gains; rewired permutes edge destinations; disconnected removes
cross-neuron recurrence.

| Mode | Development complete Delta | Blind-v5 complete Delta |
|---|---:|---:|
| Real edges, trainable gains | 86.28% | 81.25% |
| Real edges, frozen gains | 85.89% | 77.50% |
| Rewired edges, trainable gains | 85.83% | 80.00% |
| Disconnected recurrence | 84.50% | 75.00% |

The real trainable topology leads complete-Delta accuracy in these matched
runs, by 0.39--1.78 points on development and 1.25--6.25 points on blind-v5.
That is not enough to claim biological-topology superiority: this is one graph
sample, one seed and one small synthetic blind suite, while disconnected also
wins some component metrics (notably development retraction). Multi-seed and
multi-subgraph confidence intervals remain required.

For auditability, v13's earlier post-freeze blind-v4 failure is preserved:
operation 73.33%, complete Delta 70.00%, and OOD routing 50.00%. v4 was then
treated as development evidence, v14 fixed the observed operation-language
gaps, and v5 was created only after v14 froze.

## Reproduce

```bash
python -m pip install -r requirements-flywire.txt
python scripts/train_flywire_delta.py --modes real --epochs 30 --out artifacts/flywire-delta-v14
python scripts/evaluate_flywire_delta_suite.py \
  --suite v5 \
  --checkpoint artifacts/flywire-delta-v14/real.pt \
  --out artifacts/flywire-delta-v14/blind-v5.json \
  --truth post_v14_freeze_blind_v5_not_used_for_training_or_model_selection
python -m unittest discover -s tests -p 'test_flywire_delta.py'
python scripts/infer_flywire_delta.py \
  '打开客厅灯' '主卧窗户调到70%' '刚才那个改成30%' '帮我写首诗' '全部撤回'
```

Raw connection data and PyTorch checkpoints stay out of Git. Small JSON reports
contain source hashes, graph hashes, metrics, traces and checkpoint hashes.

## Still not completed

- whole-brain FlyWire training;
- generative OOD completion (current result is routing only);
- the complete 46-Thing-Model action space in this neural experiment;
- streaming ASR revisions, speaker permissions, and real device execution;
- statistical conclusions across multiple graph samples and random seeds.
