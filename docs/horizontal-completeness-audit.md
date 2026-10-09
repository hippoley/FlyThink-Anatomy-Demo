# Horizontal Completeness Audit

Status: living cross-story audit. Updated 2026-10-09.

This document is the horizontal companion to `docs/user-story-closure-audit.md`.
A story is `Verified Closed` only when its vertical acceptance criteria are
closed **and** no applicable horizontal dimension below has a critical open
break.

## Status vocabulary

- **V — Verified**: exercised by code + regression evidence at the claimed scope.
- **P — Partial**: meaningful coverage exists, but one non-trivial gate remains.
- **U — Unimplemented**: required capability does not yet exist.
- **B — Blocked**: deliberately cannot be completed inside FlyThink without an
  external owner, trust root, schema or real-world evidence.
- **N — Not applicable**: the dimension is not meaningful for this story.

Dimensions:

- **F** functional completeness
- **S** state / transaction completeness
- **I** system integration
- **C** safety / correctness
- **P** performance / scalability
- **M** maintainability / version compatibility
- **O** observability / traceability
- **T** testability / independent falsification
- **U** user-value completeness
- **E** external compatibility

## Whole-home User Stories

| User Story | F | S | I | C | P | M | O | T | U | E | Remaining horizontal gate |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| Add target | V | V | V | V | N | V | V | V | V | V | none at software scope |
| Patch one slot, preserve untouched state | V | V | V | V | P | V | V | V | P | V | retained real before/after physical proof |
| Relative patch | V | V | V | V | P | V | V | V | P | V | retained relative-action hardware proof |
| Close without remove | V | V | V | V | P | V | V | V | P | V | retained real close proof |
| Remove persistent target | V | V | V | V | N | V | V | V | V | V | none; no physical claim attached |
| Replace corrected target | V | V | P | V | N | V | V | V | P | P | semantic interpretation remains external-owner evidence |
| Cancel pending | V | V | P | V | N | V | V | V | P | P | cancel-intent semantics remain external-owner evidence |
| Undo executed action | V | V | V | V | P | V | V | V | P | V | retained real proof-derived compensation run |
| Protect untouched state | V | V | P | V | N | V | V | V | P | P | protect-intent detection remains external-owner evidence |
| Multi-target / set operation | V | V | V | V | P | V | V | V | P | V | retained real multi-device atomic evidence |
| Pronoun / coreference / correction / clarification | P | P | P | V | N | V | V | V | P | P | upstream contextual-state owner must supply durable semantic truth |
| Interruption / resume / long dialogue | P | P | P | V | N | V | V | V | P | P | persistent conversation/task ownership remains upstream |

## Execution-truth User Stories

| User Story | F | S | I | C | P | M | O | T | U | E | Remaining horizontal gate |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| Untrusted reasoner cannot actuate | V | V | V | V | N | V | V | V | V | V | none |
| Exact Context + World identity | V | V | V | V | N | V | V | V | V | V | none |
| Authorization receipt integrity + action/context binding | V | V | V | V | N | V | V | V | V | V | none at local-integrity scope |
| Authorization Trust Domain / signing-key source | P | N | P | P | N | V | V | P | P | P | external verifier + non-request-controlled trust configuration must reach canonical boundary |
| Optional authorization issuer identity | P | N | P | P | N | V | V | P | P | P | only applicable when deployment pins issuer; must not be required by default |
| Ambiguous transport remains INDETERMINATE | V | V | V | V | P | V | V | V | P | V | retained real lost-ACK / ambiguity evidence |
| Completion requires precommitted criterion + witness | V | V | V | V | P | V | V | V | P | V | retained real Golden Proof |
| Independent object-level outcome observation | U | U | B | V | N | V | V | V | P | P | separately trusted observer + retained real run |
| Offline third-party verification | V | V | V | V | P | V | V | V | P | V | retained live-hardware bundle + separate provenance |
| Kernel conformance outside repository | V | V | V | V | N | V | V | V | V | P | separately owned L5b consumer |
| External physical-completion verifier rail | V | V | V | V | N | V | V | V | V | P | independently owned host/consumer |
| Claim-scope interoperability | V | V | V | V | N | V | V | V | V | P | independent conformance/regression dependency |
| External standards feedback | N | N | P | N | N | V | V | V | V | V | citation exists; downstream dependency remains stronger evidence |

## Current cross-story P0 / P1 findings

### P0 — claim laundering

Current software P0 remains closed only while these implications stay impossible:

```text
authorization receipt self-hash
  != external Trust Domain / signing-key-source verification

Trust Domain verification
  != optional issuer identity authentication

controller/state readback completion
  != independent object-level observation

proof-bundle integrity
  != artifact provenance / transparency
```

Any regression that recreates one of these implications reopens P0 immediately.

### P1 — externally governed transaction trust

The current highest-value P1 is not a FlyThink-owned signature scheme. It is:

```text
trusted deployment/runtime configuration
  -> Trust Domain + signing-key/JWKS source
  -> externally governed Transaction Token verifier
  -> exact FlyThink tctx/action/world binding
  -> canonical execution boundary
```

Transaction Tokens draft-11 makes `iss` optional. FlyThink therefore keeps
Trust Domain/key-source verification separate from optional issuer authentication.

The current Kontxt experiment is only an interoperability candidate until its CI
passes and the trust anchor is bound at the canonical boundary.

## Cross-story regression set required for every trust-layer change

A trust-layer change is not horizontally closed unless all of the following are
re-run:

1. execution-receipt verification;
2. proof-bundle backward compatibility;
3. claim-scope anti-laundering tests;
4. canonical live APPLY boundary tests;
5. authorization single-use / replay protection;
6. wrong audience / wrong key / expired token negative cases;
7. optional-issuer behavior;
8. exact tctx action/world/completion bindings;
9. proof-derived UNDO regression;
10. public docs / maturity tables checked for stronger-than-code claims.

## Verified Closed rule

A User Story may be marked **Verified Closed** only when:

```text
vertical acceptance passes
AND
all applicable horizontal dimensions are V
OR
remaining non-V dimensions are explicitly outside the story's claim scope
AND
no P0 implication above can be derived
```

`B` is not failure when the external dependency is genuinely outside
FlyThink's authority and the runtime fails closed. It is failure if FlyThink
silently guesses or promotes the missing truth.
