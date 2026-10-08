# Physical completion external verifier rail

This directory demonstrates the smallest reusable part of FlyThink's physical-execution evidence model.

It is deliberately **not** a new general-purpose receipt protocol. The input is a conformance/test vector carrying:

- a completion criterion whose digest was fixed at authorization time;
- one physical execution/readback receipt;
- witness identity, source and method;
- observation timing / freshness;
- hardware identity;
- the observed value used to evaluate the criterion.

Run:

```sh
node scripts/verify_physical_completion_vector_cli.cjs interop/physical-completion/sample-proven.json
```

The final stdout line is a single JSON object shaped for external verifier harnesses:

```json
{"verdict":"valid","codes":[],"result":"PHYSICAL_COMPLETION_PROVEN","tiers":["independent-physical-witness"]}
```

`verdict` answers whether the evidence package is internally valid. `result` answers what can be established about real-world completion. These are intentionally separate: valid-but-insufficient evidence can produce `PHYSICAL_COMPLETION_INDETERMINATE`.

Current result vocabulary:

- `PHYSICAL_COMPLETION_PROVEN`
- `PHYSICAL_COMPLETION_NOT_SATISFIED`
- `PHYSICAL_COMPLETION_INDETERMINATE`

Important boundary: this rail does not verify the whole FlyThink execution chain, delegation policy, legal/safety policy, or model correctness. It appraises only the completion-criterion/witness slice. Full execution truth remains `execution-receipt.v1` / `execution-proof-bundle.v1`.

Design motivation: existing observed-effect suites already cover retry duplication, effect-not-yet-witnessed, timeout-not-equal-no-write, observer commitments and independent-observation tiers. This rail focuses on the narrower additional question: **did the independently observed state satisfy the exact completion criterion fixed before actuation?**