# FlyThink user-story closure audit — 2026-10-09

This audit answers a narrower question than the README:

> For every advertised user story, is the missing work code, retained reality
> evidence, an upstream semantic dependency, or an intentional fail-closed
> boundary?

A story is not "open" merely because it lacks live hardware evidence, and a
story is not "closed" merely because a deterministic fixture passes.

## Classification

- **CODE_CLOSED** — durable runtime path and regression coverage exist.
- **REALITY_OPEN** — code path exists; promotion requires retained real-world
  evidence.
- **EXTERNAL_OWNER** — FlyThink consumes/verifies the contract but must not mint
  the semantic truth.
- **INTENTIONALLY_BLOCKED** — missing schema/authority makes execution unsafe;
  fail-closed behavior is the implemented feature.

## Whole-home stories

| Story | Classification | Current truth | Next valid maturity transition |
| --- | --- | --- | --- |
| Add target | CODE_CLOSED | canonical `ADD_DEVICE`; missing target creation rules are fail-closed | real multi-device evidence only if a physical claim is promoted |
| Patch one slot, preserve untouched state | REALITY_OPEN | canonical patch + untouched-state invariant + physical runtime | retained Golden Proof showing exact before/after |
| Relative patch | REALITY_OPEN | `PATCH_RELATIVE` is in canonical runtime and frozen acceptance | retained relative-action hardware proof if publicly promoted |
| Close without remove | REALITY_OPEN | `CLOSE_DEVICE` is distinct from persistent removal | retained real-hardware close proof |
| Remove persistent target | CODE_CLOSED | `REMOVE_DEVICE` is distinct from physical close | no physical claim should be attached |
| Replace corrected target | CODE_CLOSED / EXTERNAL_OWNER | runtime replace semantics are closed; interpretation belongs upstream | upstream semantic evidence, not new FlyThink parsing |
| Cancel pending | CODE_CLOSED / EXTERNAL_OWNER | pending namespace and terminal-state refusal are closed | upstream cancel-intent ownership |
| Undo executed action | REALITY_OPEN | proof-derived compensation, divergence guard, fresh authorization, physical-boundary execution | retained real compensated run |
| Protect untouched state | CODE_CLOSED / EXTERNAL_OWNER | `PROTECT` invariant is enforced | upstream semantic detection |
| Multi-target / set operation | REALITY_OPEN | atomic write-set validation + readback contract exists | retained real multi-device atomic evidence |
| Pronoun/coreference/correction/clarification | EXTERNAL_OWNER | contextual-state is consumed, not minted | NLUSLOT/context-owner maturity |
| Interruption/resume/long dialogue | EXTERNAL_OWNER | browser/research fixtures remain useful but are not durable semantic truth | upstream persistent conversation/task owner |

## Execution-truth stories

| Story | Classification | Current truth | Next valid maturity transition |
| --- | --- | --- | --- |
| Untrusted reasoner cannot actuate | CODE_CLOSED | proposal is non-authoritative | none |
| Exact Context + World identity | CODE_CLOSED | external context identity + authoritative WorldSnapshot are bound before execution | none |
| Authorization reverified at execution boundary | CODE_CLOSED | canonical runtime re-verifies before driver entry | stronger issuer authenticity may come from external standards integration |
| Ambiguous transport remains INDETERMINATE | REALITY_OPEN | fail-closed semantics are implemented | retained real lost-ACK / ambiguous transport evidence |
| Completion requires precommitted criterion + witness | REALITY_OPEN | criterion/witness binding and verifier exist | retained real Golden Proof |
| Offline third-party verification | CODE_CLOSED for frozen fixtures / REALITY_OPEN for live hardware | proof bundle is portable; Sigstore provenance is separate | retained real-hardware bundle |
| Kernel conformance outside repo | CODE_CLOSED at L5a | NLUSLOT pins/runs FlyThink kernel contract | separately owned consumer for L5b |
| External physical-completion verifier rail | CODE_CLOSED at interface level | EVC-02-style isolated verifier rail exists | independently owned host consumes it |
| External standards feedback | ACHIEVED for AER-1 | draft-zambo-aer1-14 records FlyThink four-case interop fixture | upstream conformance/regression dependency is stronger than citation |

## Intentionally blocked stories

These must not be "completed" by guessing:

- service execution while service input schemas are unavailable;
- nested-value writes without full nested schema validation;
- event capabilities treated as commands;
- FlyThink minting persistent semantic conversation/task identity;
- authorization evidence being promoted into physical-completion evidence.

For these stories, the correct implementation is rejection until an upstream
schema or authority becomes available.

## Remaining reality gates

### Golden Proof

The code-level dual execution entrypoint is closed: the live APPLY path reaches
WindowPilot through `runDecisionProposal()`.

The unresolved gate is now only:

```text
reviewed human WAV
-> externally sealed contextual-state.v1 identity
-> authoritative WorldSnapshot identity
-> canonical DecisionProposal
-> canonical runtime
-> bounded real WindowPilot write
-> ACK + fresh measured readback
-> safe closeout
-> execution-receipt.v1
-> execution-proof-bundle.v1
-> offline VERIFIED
-> separate provenance attestation
```

No additional abstraction work should be credited toward this gate.

### Real compensation proof

Undo is code-closed at L3. Promotion requires a real execution bundle from which
the compensation is derived, a fresh authorization, a physical compensating
write, and retained verification of the resulting state.

### Real multi-device atomic proof

The runtime contract is closed. Promotion requires a retained physical run
showing all intended writes/readbacks and no partial-success claim when the
atomic set cannot be established.

### L5b independent dependency

Cross-repository consumption under the same owner is L5a, not L5b. AER-1
citation is external standards feedback, but citation is still not dependency.

L5b requires a separately owned repository, host, verifier or CI that pins and
runs a FlyThink contract.

## Stop rule

Do not add a new model, schema, receipt type or research branch unless it does
one of the following:

1. moves a row across a maturity boundary;
2. exposes a falsifiable external interoperability gap;
3. converts an external citation into a conformance/downstream dependency; or
4. supplies retained real-world evidence for an existing reality gate.

Everything else is lower-value than closing one of the gates above.
