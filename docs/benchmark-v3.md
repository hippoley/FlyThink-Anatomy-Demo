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
accepts a `--release-id YYYY-MM` and, for semantic-contract revisions within a
published period, `YYYY-MM-rN`. The release ID deterministically derives a new
seed while preserving the applicable generator and validation contract.

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


## Baseline discrimination validity gate

A benchmark can be objectively scored and still be invalid if a trivial policy
receives a high score. V3 therefore ships deterministic, capability-bounded
validity baselines:

- `clarify_only`: never mutates state;
- `surface_direct`: handles only explicit one-target surface forms;
- `context_rule`: adds bounded focused-target relative actions, explicit
  corrections and simple two-target sets;
- `gold_oracle`: emits the benchmark's exact gold transition.

The validity gate requires the oracle to reproduce 100% patch/state/trajectory
truth and requires a material margin between the oracle and the strongest
non-oracle baseline. Weak baselines must not strict-pass a large fraction of
trajectories.

These baselines are benchmark diagnostics, not model competitors. Their purpose
is to catch scoring loopholes and distribution artifacts such as a benchmark
where doing nothing, always clarifying or shallow keyword rules receive
misleadingly high scores.


## Immutable historical releases and semantic profiles

Published evidence must remain reproducible even when the benchmark itself finds
a gold-contract bug.

The original `2026-10` release is therefore permanently bound to its published
trajectory SHA and `long-trajectory-v3.1` semantics. The generator fails if
that release drifts.

Starting with revision-style releases such as `2026-10-r2`, V3 uses
`long-trajectory-v3.2` / `existing_device_power_v3_2` semantics:

- all devices already present in `initial_runtime` are persistent existing
  targets;
- turning an existing device on is `PATCH_SLOT(power=ON)`, not
  `ADD_DEVICE`;
- `ADD_DEVICE` remains reserved for the distinct Add-target User Story;
- physical/persistent close remains distinct through `CLOSE_DEVICE`.

This intentionally does **not** rewrite the historical `2026-10` evidence.
Comparisons must report the release ID and generator/semantic profile together.


## Robustness taxonomy for v3.2+

V3.2 adds **surface-only** robustness slices without changing canonical device
identity or write-set truth.

The taxonomy deliberately separates:

- `single_intent`: one explicit target/action;
- `multi_intent`: one utterance producing a multi-target write set;
- `omitted_attribute`: relative/coreference commands whose target/slot must be
  recovered from gold conversational context;
- `underspecified_target`: requests whose gold state proves clarification is
  required;
- `non_standard_alias`: a non-canonical device surface name mapped to the same
  canonical target.

Alias vocabularies are split-disjoint. Train uses canonical device names only;
dev and sealed use different held-out Chinese aliases. The alias changes only
the utterance surface. `gold_target`, device registry identity and write-set
oracle remain canonical.

This taxonomy is informed by mature smart-home parsing benchmarks that separate
multi-intent, omitted-attribute and non-standard naming robustness. FlyThink
does **not** mix an external English ontology into its canonical score; it
reuses the evaluation dimension while preserving its own Chinese runtime
contract.

The published `2026-10` legacy release remains byte-compatible and receives no
new robustness metadata.


## External data-quality modules

Benchmark V3 uses two development-only external libraries. Neither is imported
by the physical execution runtime.

- **RapidFuzz 3.14.6 (MIT)** scans cross-split utterances after masking room,
  device-name aliases and numeric values. Exact overlap remains prohibited by
  the core validator; RapidFuzz adds a near-duplicate gate so superficial token
  substitutions cannot hide template leakage.
- **Hypothesis 6.168.5 (MPL-2.0)** exercises release-seed determinism, split
  partition balance, generated gold write-set/state consistency, non-mutating
  non-EXECUTE turns and corrected existing-device power semantics across
  generated release IDs and corpus sizes.

Versions are pinned in `requirements-benchmark.txt`. The
`benchmark-v3-external-quality` suite installs and executes these modules as
part of the machine-readable User Story impact graph.

They are intentionally kept outside production dependencies: their role is to
falsify benchmark/data assumptions, not participate in inference or actuation.


## Train/dev checkpoint adapter

Benchmark V3.2 can improve the existing checkpoints without tuning on a sealed
release. `benchmark_v3_training_adapter.py` converts only V3.2 train/dev turns
into the existing checkpoint training contracts.

Judgement rows use runtime-shaped context keys such as `focused_target`,
`referent_set`, `device_keys` and `device_registry`. EXECUTE and CLARIFY
additions are bounded and decision-balanced so the augmentation cannot turn the
safety classifier into an execute-biased shortcut.

Semantic rows are emitted only for EXECUTE turns and are bounded per scenario
family. They supervise only the four semantic heads already owned by the
checkpoint: operation, cardinality, relative direction and value presence.
Target resolution and concrete value materialization remain downstream
responsibilities.

The adapter never exports V3 sealed rows. Existing judgement `final` and
semantic `sealed` corpora are inherited byte-for-byte from their previous
builders. V3 sealed releases remain evaluation-only.


## scikit-learn checkpoint challenger

A mature external challenger is intentionally kept beside the custom neural
checkpoint rather than replacing it without evidence.

`scikit-learn 1.9.1` supplies a fixed train-only character n-gram TF-IDF +
LogisticRegression baseline for:

- the judgement decision;
- semantic operation;
- cardinality;
- relative direction;
- value-presence semantics.

The challenger uses the same V3.2 train/dev adapter and inherited evaluation
corpora as the neural checkpoints. Hyperparameters are frozen in code and no
dev/sealed set is used for fitting or parameter search.

This is an architectural falsification test: if the simpler mature wheel
matches or beats the custom topology backend on the relevant dev families, the
project should prefer the cheaper replaceable backend unless the custom model
demonstrates a separate durable advantage.
