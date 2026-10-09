# NOA consumer-semantics interoperability probe

Status: experimental upstream-contribution candidate.

This probe targets the public gap described by NOA Mandate Core ADR-R-006 and
roadmap §1: a source-to-consumer mapping contract that preserves receipt field
semantics and detects consumer mismatch.

It deliberately does **not** implement or import the NOA verifier.

CI checks out a pinned NOA revision and consumes its real
`conformance/action-digest/vectors.json` fixture. The selected source receipt
has distinct values for:

```text
action.id        = deploy.apply
action.canonical = deploy.apply:prod/api
```

That makes accidental field aliasing observable.

The current contrastive cases require a consumer to refuse:

- `action.id` / `action.canonical` transposition;
- consumer-side `paramsHash` rederivation/substitution;
- source outcome normalization such as `ALLOWED -> PASS`;
- invention of a controller-success claim absent from `noa.receipt/0.1`;
- invention of a physical-completion claim absent from `noa.receipt/0.1`.

The valid case preserves all mapped values exactly.

## Claim boundary

This is not NOA conformance, SCITT conformance, or evidence that NordenSoft
adopted FlyThink. It is a reproducible external interoperability probe against
one immutable upstream revision.

The intended upstreamable shape is:

```text
verified source receipt
  -> semantic projection
  -> positive/negative consumer vectors
  -> deterministic mismatch/refusal code
```

Source verification remains owned by the source protocol. The consumer layer
must not manufacture stronger claims from a valid receipt.
