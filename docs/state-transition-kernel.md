# State-transition kernel: model-agnostic research boundary

## Decision recorded 2026-10-09

The same-budget decision gate in PR #121 falsified the working assumption that
the real FlyWire topology should be promoted as the default bounded GraphDelta
kernel.

The retained full run found the MLP to be the provisional Pareto winner on the
current bounded task. Real FlyWire did not consistently beat rewired or
disconnected controls and did not satisfy the predeclared topology-promotion
rule.

Therefore:

- **FlyWire topology is research history / an optional hypothesis, not product identity.**
- no v19/v20-style accuracy iteration counts as product progress without a new
  falsifiable topology hypothesis;
- the durable research question is model-agnostic:

> What is the smallest reliable state-transition kernel that maximizes useful
> coverage under a high-precision commit constraint?

## Durable interface

The kernel is allowed to map already-normalized semantic/state inputs into a
bounded structured proposal. It is not allowed to own:

- open-language understanding;
- persistent conversation truth;
- authorization;
- direct actuator access;
- physical completion truth.

Conceptually:

```text
open language
  -> semantic normalization / persistent contextual state
  -> bounded state-transition kernel
  -> GraphDelta proposal + calibrated confidence
  -> abstention / deterministic checks
  -> FlyThink execution boundary
  -> measured witness + proof
```

The kernel may be implemented by an MLP, GRU, tiny Transformer, SSM, sparse
graph model, symbolic classifier or another future architecture as long as it
obeys the same input/output and evaluation contract.

## Promotion metrics

Raw accuracy is secondary. The deployment-facing metric is a risk/coverage
curve measured with a threshold calibrated on development data and frozen before
sealed evaluation.

Required reporting:

- structured patch exactness;
- commit precision vs coverage;
- wrong-target / wrong-device rate;
- untouched-state corruption;
- OOD false-commit rate;
- relative/coreference/multi-intent subsets where semantically applicable;
- CPU latency, memory and parameter count;
- multiple seeds;
- threshold source and split identity.

A sealed set must never choose its own confidence threshold.

## Research discipline

A kernel is promoted only for a reproducible Pareto improvement. Biological,
architectural or branding provenance is irrelevant to promotion.

Negative results remain first-class evidence. The repository should preserve
the FlyWire result because the ability to falsify a favored architecture is
part of the infrastructure's credibility.

## Next infrastructure step

The highest-value next step is not another private model variant. It is a
**kernel conformance rail** that lets a third party provide predictions and
confidence values against a versioned frozen corpus and receive the same
risk/coverage + safety report.

That rail creates a dependency surface independent of whichever model wins.
