# Adoption evidence ledger

This ledger records **actual consumption**, not intended integrations.

It deliberately distinguishes self-owned cross-repository use from independent
third-party adoption so that repository claims cannot outrun the evidence.

## 2026-10-09 — NLUSLOT consumes kernel conformance rail

Consumer repository:

```text
hippoley/NLUSLOT
```

Consumer merge:

```text
f12b6163899309c1d8d5469ea13da41543fc5005
```

FlyThink dependency pinned by the consumer:

```text
d1c3f3619b400153f17731df12a71f0b472ff9fc
```

Consumer CI run:

```text
37873409257
```

Result:

```text
flythink-kernel-conformance-consumer = success
```

The NLUSLOT adapter maps its typed-action trajectory evaluator output into the
versioned FlyThink conformance-row contract and invokes the FlyThink composite
GitHub Action by immutable commit SHA.

### What this proves

- the conformance rail can be consumed outside the FlyThink repository;
- the public action works when invoked from a separate repository;
- the model/evaluator can remain owned by the caller;
- the FlyThink dependency can be pinned immutably;
- a downstream CI can retain the generated conformance report.

### What this does not prove

NLUSLOT and FlyThink are controlled by the same owner. Therefore this is
**L5a cross-repository consumption**, not independent third-party adoption,
endorsement, citation or standards acceptance.

The next adoption milestone is L5b: a separately owned project or verifier
chooses to pin and run the contract without being created solely to satisfy
this maturity metric.
