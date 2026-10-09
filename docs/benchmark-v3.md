# Long-Trajectory Benchmark V3

V3 is a benchmark-design upgrade, not a larger copy of V2.

It keeps objective whole-home state and write-set oracles, but adds:

- train/dev/sealed splits;
- split-isolated surface-template families;
- shared entity vocabulary with room×entity compositional holdouts;
- EXECUTE and CLARIFY decisions;
- direct, relative/coreference, correction, multi-target and ambiguity families;
- explicit difficulty labels;
- manifest SHA verification over the canonical trajectory payload;
- cross-split text/template leakage checks;
- state-diff == gold-write-set validation;
- per-family and per-difficulty metrics;
- repeated-run strict+safety reliability (`pass_pow_k`).

The sealed split is intended for evaluation only. Do not use it for checkpoint
selection, prompt tuning or threshold calibration.

## Why

V2 verifies long state preservation well, but its fixed templates and all-EXECUTE
distribution make it possible to score highly through narrow pattern matching.
V3 makes that failure mode visible without replacing V2's stable historical
regression role.

The design borrows the useful parts of modern agent evaluation: objective final
state oracles, interactive/long-horizon behavior, holdout generalization and
repeated-run reliability. It intentionally avoids LLM-as-judge scoring for the
canonical state-transition claims.
