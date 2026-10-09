# External kernel conformance

The conformance rail can be consumed as a GitHub composite action from another repository.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: hippoley/FlyThink-Anatomy-Demo/.github/actions/kernel-conformance@main
    with:
      calibration: path/to/calibration.json
      sealed: path/to/sealed.json
      target-precision: "0.99"
      out: kernel-conformance-report.json
```

The caller owns the model. FlyThink does not import, host, or privilege any architecture.
The contract consumes only frozen per-case results and computes the same threshold and
sealed evaluation semantics for every implementation.

## Why this is a dependency surface

A third-party repository can pin this action by commit SHA and use it in CI. That creates
a durable integration boundary independent of FlyWire, MLP, GRU, Transformer, SSM, or
future model families.

The action is intentionally small:

- calibration selects the threshold;
- sealed labels never select their own threshold;
- equal-confidence ties cannot be cherry-picked;
- optional safety fields are reported for committed rows;
- output is plain JSON and can be retained as an artifact.

For stronger interoperability, pin a commit SHA rather than `main`.
