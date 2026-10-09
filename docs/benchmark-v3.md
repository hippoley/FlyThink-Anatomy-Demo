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


## Release refresh policy

A public sealed set is only "sealed" with respect to the current development
cycle; once published, future models may eventually ingest it. V3 therefore
accepts a `--release-id YYYY-MM`. The release ID deterministically derives a
new seed while preserving the generator and validation contract.

Recommended policy:

- freeze one release for a checkpoint-selection cycle;
- never tune on that release's sealed split;
- publish its manifest + SHA with results;
- rotate to a newer release for future external comparisons;
- keep old releases reproducible for longitudinal regression, but do not treat
  them as permanently contamination-resistant.

This is intentionally closer to a living benchmark model than a one-time static
test set.


## Clarification truth rule

A CLARIFY label is only valid when ambiguity is derivable from the gold
conversation state, not merely because the surface text contains a pronoun.

V3 currently permits two explicit ambiguity bases:

- `no_prior_focus`: the request is the first turn, so there is no focused target;
- `multi_referent_set`: the immediately previous gold execution targeted two or
  more devices, which leaves a multi-item referent set and no unique focused
  target under the canonical runtime context adapter.

The validator rejects CLARIFY rows that do not prove one of these conditions.


## Causal score decomposition

A long-horizon benchmark should not collapse local capability and state cascade
into one aggregate number.

V3 therefore has three complementary views:

1. **Stateful execution** — run the full trajectory using the model's own prior
   outputs and persistent runtime state. This measures end-to-end reliability.
2. **Teacher-forced local competence** — evaluate each turn with the correct
   gold runtime and gold applied-patch history as its prefix. This measures
   whether the upstream model can solve the turn when its prerequisites are
   correct.
3. **First-failure ledger** — retain exactly one uncapped first failure per
   trajectory run, then join it with the teacher-forced result to distinguish
   local capability failures from failures caused only after state divergence.

The detailed per-turn failure list may remain capped for artifact size, but the
first-failure ledger must never be truncated.

Canonical reporting should show both stateful and teacher-forced metrics. A
higher teacher-forced score with a low stateful score indicates trajectory
stability/context propagation problems; low values in both indicate local
semantic capability gaps.
