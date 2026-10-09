# Kontxt external Transaction Token verifier experiment

Status: P1 interoperability experiment. Not wired into the canonical FlyThink
execution boundary yet.

## Why this candidate

FlyThink must not implement its own JWT verifier merely to make a trust claim
look complete.

The pinned external implementation:

- repository: `aramase/kontxt`
- commit: `d23ebb50121a650af57c9e34e8227d54db324f9d`
- verifier: `sdk/verify`

has a real downstream TxToken verifier that performs JWKS signature validation,
RSA signing-method restriction, `kid` lookup, JWT time validation, audience
checking and `typ=txntoken+jwt` enforcement.

## Standards correction: issuer is not the primary trust primitive

Transaction Tokens draft-11 makes `iss` OPTIONAL. The token is primarily bound
to one Trust Domain through `aud`, with signing keys known through deployment
configuration.

That means FlyThink must not force this false equivalence:

```text
Transaction Token trust == mandatory issuer claim
```

The core FlyThink trust adapter therefore pins:

```text
configured JWKS endpoint
+ configured audience / Trust Domain
+ trust-anchor provenance source
```

and constructs the Kontxt verifier internally from that configuration.

An issuer may additionally be pinned by the FlyThink deployment profile. When
it is configured, the token must carry the exact matching `iss`, and the
adapter may report:

`issuer_authenticated_against_configured_trust_anchor=true`

When no issuer is configured, a draft-11-valid token without `iss` can still
pass, and issuer authenticity is deliberately **not** claimed.

## Layered semantics

The experiment keeps these facts separate:

```text
Kontxt sdk/verify against configured JWKS + audience
  -> cryptographic_validation_verified
  -> trust_domain_key_source_verified

optional configured issuer + matching iss
  -> issuer_authenticated_against_configured_trust_anchor

required claims + exact scope / requesting workload
  -> required_claims_verified

exact tctx.flythink action/world/registry/completion bindings
  -> flythink_profile_binding_verified

all mandatory layers above
  -> ready_for_canonical_trust_integration
```

The optional issuer layer does not decide whether the core trust-domain
verification is valid.

## Negative cases

The CI experiment must prove that:

- wrong audience is rejected by Kontxt;
- expired tokens are rejected by Kontxt;
- a token carrying the expected issuer but signed by an unrelated key source is
  blocked by Kontxt;
- when an issuer is explicitly pinned, a token signed by the configured key
  source but carrying a different issuer is blocked;
- a draft-11 token omitting `iss` succeeds when the FlyThink profile does not
  require one;
- missing `tctx` and mismatched FlyThink action digests remain blocked after
  successful cryptographic verification;
- a trust anchor without provenance metadata is rejected before any token
  verification attempt.

## Retention and reproducibility

The adapter result retains only SHA-256 of the raw Transaction Token plus a
SHA-256 of the configured trust anchor and its provenance source. The raw token
is not retained.

The external repository is checked out at the exact commit above. The small
interop module also carries the checksums required for the Kontxt packages used
by this test so CI does not depend on an unlocked consumer-module state.

## Non-claims

- This experiment is not a claim that the pinned Kontxt revision conforms to
  every detail of Transaction Tokens draft-11.
- A configured JWKS URL is a deployment trust root; this adapter does not
  magically prove the administrative provenance of that configuration.
- This is not yet part of `runDecisionProposal()`.
- FlyThink's canonical receipt should not use
  `authorization_issuer_authenticated_verified` as a synonym for general
  Transaction Token trust, because draft-11 does not require `iss`.
- Canonical integration should expose a separate trust-domain/key-source claim,
  while preserving the issuer-authentication claim only when an issuer is
  actually configured and verified.
