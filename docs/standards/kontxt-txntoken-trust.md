# Kontxt external Transaction Token verifier experiment

Status: P1 interoperability experiment. Not wired into the canonical FlyThink
execution boundary yet.

## Why this candidate

FlyThink must not implement its own JWT verifier merely to turn
`authorization_issuer_authenticated_verified` from false to true.

The pinned external implementation:

- repository: `aramase/kontxt`
- commit: `d23ebb50121a650af57c9e34e8227d54db324f9d`
- verifier: `sdk/verify`

has a real downstream TxToken verifier that performs JWKS signature validation,
RSA signing-method restriction, `kid` lookup, JWT time validation, audience
checking and `typ=txntoken+jwt` enforcement.

## Important trust-boundary correction

Kontxt's verifier accepts a caller-configured JWKS URL and audience. It does not
itself prove that the token's `iss` claim owns that JWKS endpoint.

Therefore this experiment does **not** equate:

```text
iss claim == expected string
```

with issuer authenticity.

Instead FlyThink supplies one explicit execution-boundary trust anchor:

```text
configured issuer
+ configured JWKS endpoint
+ configured audience
+ trust-anchor provenance source
```

The adapter constructs the Kontxt verifier internally from that anchor. A caller
can no longer inject an arbitrary verifier pointed at another JWKS endpoint while
still presenting the declared issuer binding.

The verdict retains a SHA-256 digest of the trust anchor and the configured
provenance source, not the raw Transaction Token.

## Layered semantics

The experiment keeps these facts separate:

```text
Kontxt sdk/verify against configured JWKS
  -> cryptographic_validation_verified

signature verified against configured key source
+ token iss == configured issuer
  -> issuer_authenticated_against_configured_trust_anchor

required claims + exact scope / requesting workload
  -> required_claims_verified

exact tctx.flythink action/world/registry/completion bindings
  -> flythink_profile_binding_verified

all above
  -> ready_for_canonical_trust_integration
```

The issuer-authentication statement is deliberately scoped **against the
configured trust anchor**. The canonical FlyThink execution boundary must still
prove that this trust anchor came from trusted deployment/runtime configuration
rather than proposal-controlled input before the production receipt can upgrade
`authorization_issuer_authenticated_verified`.

## Negative cases

The CI experiment must prove that:

- a token signed by the configured key source but carrying the wrong `iss` is
  blocked at issuer binding;
- a token carrying the expected `iss` but signed by an unrelated key source is
  blocked by Kontxt before FlyThink profile checks;
- wrong audience and expiration are rejected by Kontxt;
- missing `tctx` and mismatched FlyThink action digests remain blocked after
  successful cryptographic verification;
- a trust anchor without provenance metadata is rejected before any token
  verification attempt.

## Dependency pinning

The external repository is checked out at the exact commit above. The small
interop module also carries the checksums required for the Kontxt packages used
by this test so CI does not silently depend on an unlocked consumer module state.

## Non-claims

- Kontxt currently describes its token model as draft-08, while the IETF draft
  continues to evolve.
- This experiment is not a claim of current Transaction Token draft conformance
  by Kontxt.
- This is not yet part of `runDecisionProposal()`.
- The trust-anchor provenance is configuration evidence, not a self-proving root
  of trust.
- FlyThink's canonical execution receipts must continue to report
  `authorization_issuer_authenticated_verified=false` until the external
  verifier and a non-request-controlled trust anchor are executed and bound at
  the canonical authorization boundary.
