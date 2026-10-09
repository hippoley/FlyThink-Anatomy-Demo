# EVC-02 external verifier for physical completion

Status: implementation experiment against `draft-kondoju-evc-02`; not an IETF conformance or endorsement claim.

FlyThink implements the verifier side of the EVC wire boundary for one deliberately narrow dependent-action question:

> May a later privileged action proceed only if an earlier physical action has already satisfied an authorization-bound completion criterion?

## Wire contract

The command:

```sh
node scripts/evc_physical_completion_verifier.cjs
```

reads exactly one EVC wire-version-1 request from stdin and writes exactly one closed-schema EVC verdict to stdout.

The proof bundle remains opaque to the host. For this verifier, `bundle` is a JSON string containing a `flythink.physical-completion-vector.v0.1` object.

The open EVC request object carries one verifier-specific field:

```json
{
  "required_precondition": {
    "type": "physical_completion",
    "criterion_sha256": "<authorization-bound criterion digest>"
  }
}
```

The verifier emits `kind: "external"`, as required for an external-class verifier under the current EVC draft.

## EVC-02 fd-level stdout isolation

The implementation uses two processes:

```text
EVC host
  -> parent verifier stdin
  -> isolated worker
       fd1 -> captured by parent and forwarded to stderr
       fd2 -> stderr
       fd3 -> private verdict channel
  -> parent performs the only host-facing stdout write
```

This matters because a dependency can write directly to fd1 without using the language-level logging API. The regression suite deliberately injects worker stdout noise and proves that host-facing stdout still contains exactly one JSON verdict.

A worker crash or invalid private verdict channel produces `deny code=internal_error` and a non-zero verifier exit. Decision-level denies such as `invalid_proof` or `request_mismatch` exit zero.

## Claim boundary

EVC owns the host↔verifier transport and fail-closed verdict envelope. FlyThink owns only appraisal of the opaque physical-completion vector.

`allow` means the requested physical-completion precondition is proven by FlyThink's current evidence rules. It does not mean the later action is globally safe, legal, correct or wise; the EVC host remains responsible for enforcing the verdict and its own policy.

This adapter does not redefine EVC, does not add a denial code, does not change the wire major, and does not claim that FlyThink's proof format is part of EVC.

## Strategic role

The durable integration surface is not a FlyThink-specific agent API. It is a standards-shaped verifier boundary that another host can spawn without importing FlyThink internals.
