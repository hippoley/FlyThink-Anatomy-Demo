# Execution proof quickstart

FlyThink keeps one canonical proof-bundle verifier. This directory does not
reimplement verification in a browser or a second library.

Generate a deterministic sample bundle from the canonical builders:

```sh
node scripts/build_public_execution_proof_sample.cjs
```

Then verify it with the same CLI used for retained evidence:

```sh
node scripts/verify_execution_proof_bundle_cli.cjs \
  interop/execution-proof/sample-completion-proven.json
```

A successful current sample reports both:

```text
physical_truth_verified = true
physical_completion_verified = true
```

The sample is synthetic/deterministic interoperability evidence. It is **not**
a real-hardware Golden Proof. The real-hardware claim remains pending until a
protected physical-lab run produces and retains its own bundle.