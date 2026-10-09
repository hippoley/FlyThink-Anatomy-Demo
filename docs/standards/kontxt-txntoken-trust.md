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
RSA algorithm restriction, `kid` lookup, JWT time validation, audience checking
and `typ=txntoken+jwt` enforcement.

FlyThink then adds only its application profile:

- expected issuer equality;
- required current claims are present;
- expected scope and requesting workload;
- TTS-authoritative `tctx.flythink` contains the exact action/world/registry/
  completion bindings required at the physical execution boundary.

## Why the layers stay separate

A valid signature from the configured Kontxt JWKS endpoint is not by itself a
FlyThink authorization decision.

Likewise, valid FlyThink tctx bindings without external cryptographic
verification do not authenticate the issuer.

The experiment therefore keeps:

```text
Kontxt sdk/verify
  -> cryptographic_validation_verified

expected issuer binding
  -> issuer_authenticated_verified

FlyThink tctx profile
  -> flythink_profile_binding_verified

all required
  -> ready_for_authorization_trust
```

separate.

## Retention boundary

The adapter result retains only SHA-256 of the raw Transaction Token. The raw
token is not part of the verdict.

## Non-claims

- Kontxt currently describes its token model as draft-08, while the IETF draft
  continues to evolve.
- This experiment is not a claim of draft-11 conformance by Kontxt.
- This is not yet part of `runDecisionProposal()`.
- FlyThink's canonical execution receipts must continue to report
  `authorization_issuer_authenticated_verified=false` until the external
  verifier path is actually executed at that boundary and bound to the exact
  authorization decision.
