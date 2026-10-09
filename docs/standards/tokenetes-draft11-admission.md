# Tokenetes / Transaction Tokens draft-11 admission probe

Status: interoperability probe, not a conformance certification.

FlyThink issue #137 needs an externally governed trust mechanism for authorization
issuer authenticity. The OAuth Working Group repository points to Tokenetes as an
open-source Transaction Tokens implementation, so Tokenetes is a natural candidate.

The candidate must still be checked against the **current** Transaction Tokens
surface before FlyThink can depend on it.

Pinned upstream source:

- repository: `tokenetes/tokenetes`
- commit: `f9b7acf60f2df60acbe9749e570a502aa0193fb6`
- file: `service/pkg/service/service.go`
- Git blob: `1ebdfd347d9f2b6de049c6d7bb665ebc189f1eb5`

The current draft used by this probe is
`draft-ietf-oauth-transaction-tokens-11`.

The probe checks only the issuer surface that matters for FlyThink admission:

- JWT `typ = txntoken+jwt`;
- required base claims visible in the issuer path, including `scope` and
  `req_wl`;
- `tctx` because FlyThink needs TTS-authoritative immutable transaction
  context for exact physical-action bindings.

At the pinned Tokenetes commit, the issuer path still visibly emits the older
shape `purp` / `azd` and `typ = txn_token`, while the current draft uses
`scope` / `tctx` and requires `req_wl`.

## Claim boundary

A blocked result means only:

> this pinned source snapshot is not admitted as FlyThink's current-draft-11
> Transaction Token trust-adapter candidate.

It does **not** establish that Tokenetes is insecure, unusable, or globally
non-conformant.

Likewise, a future READY result would still not close FlyThink authorization
issuer authenticity. FlyThink must execute a real consumer-side validator that
verifies signature, trust-domain audience, expiry and required claims before a
validated claims envelope can cross the execution boundary.

The probe deliberately prevents this invalid shortcut:

```text
OAuth WG README says "implementation"
!=
pinned implementation is current-draft compatible
!=
FlyThink has authenticated the authorization issuer
```
