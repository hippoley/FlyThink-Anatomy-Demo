# FlyThink user-story closure audit — 2026-10-09

This audit answers one narrow question:

> For every advertised user story, is the remaining work code, retained reality
> evidence, an upstream semantic dependency, an external trust dependency, or an
> intentional fail-closed boundary?

A story is not "open" merely because it lacks live hardware evidence, and a
story is not "closed" merely because a deterministic fixture passes.

## Classification

- **CODE_CLOSED** — durable runtime path and regression coverage exist.
- **REALITY_OPEN** — code path exists; promotion requires retained real-world evidence.
- **EXTERNAL_OWNER** — FlyThink consumes/verifies the contract but must not mint the semantic truth.
- **EXTERNAL_TRUST_OPEN** — FlyThink can verify local binding, but a stronger issuer/trust claim requires an external trust system.
- **INTENTIONALLY_BLOCKED** — missing schema/authority makes execution unsafe; fail-closed behavior is the implemented feature.

## Whole-home stories

| Story | Classification | Current truth | Next valid maturity transition |
| --- | --- | --- | --- |
| Add target | CODE_CLOSED | canonical `ADD_DEVICE`; missing target creation rules are fail-closed | real multi-device evidence only if a physical claim is promoted |
| Patch one slot, preserve untouched state | REALITY_OPEN | canonical `PATCH_SLOT` + untouched-state invariant + physical runtime | retained Golden Proof showing exact before/after |
| Relative patch | REALITY_OPEN | `PATCH_RELATIVE` is in canonical runtime and frozen acceptance | retained relative-action hardware proof if publicly promoted |
| Close without remove | REALITY_OPEN | `CLOSE_DEVICE` is distinct from persistent removal | retained real-hardware close proof |
| Remove persistent target | CODE_CLOSED | `REMOVE_DEVICE` is distinct from physical close | no physical claim should be attached |
| Replace corrected target | CODE_CLOSED / EXTERNAL_OWNER | runtime replace semantics are closed; interpretation belongs upstream | upstream semantic evidence, not new FlyThink parsing |
| Cancel pending | CODE_CLOSED / EXTERNAL_OWNER | pending namespace and terminal-state refusal are closed | upstream cancel-intent ownership |
| Undo executed action | REALITY_OPEN | proof-derived compensation, current-state divergence guard, fresh authorization and canonical physical-boundary execution | retained real compensated run |
| Protect untouched state | CODE_CLOSED / EXTERNAL_OWNER | `PROTECT` invariant is enforced | upstream semantic detection |
| Multi-target / set operation | REALITY_OPEN | atomic write-set validation + readback contract exists | retained real multi-device atomic evidence |
| Pronoun/coreference/correction/clarification | EXTERNAL_OWNER | contextual-state is consumed, not minted | NLUSLOT/context-owner maturity |
| Interruption/resume/long dialogue | EXTERNAL_OWNER | browser/research fixtures remain useful but are not durable semantic truth | upstream persistent conversation/task owner |

## Execution-truth stories

| Story | Classification | Current truth | Next valid maturity transition |
| --- | --- | --- | --- |
| Untrusted reasoner cannot actuate | CODE_CLOSED | proposal is non-authoritative | none |
| Exact Context + World identity | CODE_CLOSED | external context identity + authoritative WorldSnapshot are bound before execution | none |
| Authorization receipt integrity + action/context binding | CODE_CLOSED | v1 re-verifies exact receipt, patch, registry, source revision and completion-criterion bindings before driver entry | none at the local-integrity layer |
| Authorization single-use / replay barrier | CODE_CLOSED | persistent ledger consumption uses an exclusive writer lock plus per-authorization O_EXCL reservation; stale snapshots, restart, snapshot loss and multi-process races fail closed before driver dispatch | retained real multi-process/live-run evidence may strengthen operations, but no software closure gap remains |
| Authorization Trust Domain / signing-key source | EXTERNAL_TRUST_OPEN | current v1 self-hash cannot establish an externally governed authorization trust root; verifier explicitly returns `authorization_trust_domain_key_source_verified=false` | real Transaction Token/workload-identity validator bound to trusted runtime/deployment configuration |
| Optional authorization issuer authentication | EXTERNAL_TRUST_OPEN / PROFILE_OPTIONAL | issuer identity is separate from Trust Domain verification and is not required by every external authorization profile; verifier explicitly returns `authorization_issuer_authenticated_verified=false` | only upgrade when a configured issuer identity is separately authenticated |
| Ambiguous transport remains INDETERMINATE | REALITY_OPEN | post-dispatch driver ambiguity is quarantined; non-safety single, atomic multi-target and UNDO compensation paths all preserve the quarantine boundary; quarantine exit is only performed inside `RecoveryTransaction` after readiness, stable hardware identity, fresh in-range readback and safe-position checks—there is no caller-asserted boolean clear API | retained real lost-ACK / ambiguous transport evidence |
| Completion requires precommitted criterion + witness | REALITY_OPEN | criterion/witness binding and verifier exist | retained real Golden Proof |
| Independent object-level outcome observation | REALITY_OPEN / EXTERNAL_TRUST_OPEN | current WindowPilot completion witness is integrated controller/state readback; canonical verifier returns `independent_object_outcome_verified=false` | separately trusted object-level observer path + retained real run |
| Offline third-party verification | CODE_CLOSED for frozen fixtures / REALITY_OPEN for live hardware | proof bundle is portable; Sigstore provenance is separate | retained real-hardware bundle + provenance |
| Kernel conformance outside repo | CODE_CLOSED at L5a | NLUSLOT pins/runs FlyThink kernel contract | separately owned consumer for L5b |
| External physical-completion verifier rail | CODE_CLOSED at interface level | EVC-02-style isolated verifier rail exists | independently owned host consumes it |
| Claim-scope interoperability | CODE_CLOSED for current fixtures / EXTERNAL_DEPENDENCY_OPEN | AER/EVC/NOA fixtures preserve non-claims | upstream conformance/regression dependency or independent consumer |
| External standards feedback | ACHIEVED for AER-1 | `draft-zambo-aer1-14` Implementation Status records FlyThink's four-case AER-1/physical-completion fixture | upstream conformance/regression dependency is stronger than citation |

## Intentionally blocked stories

These must not be "completed" by guessing:

- service execution while service input schemas are unavailable;
- nested-value writes without full nested schema validation;
- event capabilities treated as commands;
- FlyThink minting persistent semantic conversation/task identity;
- authorization evidence being promoted into physical-completion evidence;
- authorization receipt self-hashes being promoted into Trust Domain/key-source verification or issuer authentication;
- proof-bundle integrity being promoted into Sigstore/SCITT provenance;
- identified controller/state readback being promoted into independent object-level observation.

For these stories, rejection or an explicit `UNVERIFIED` claim is the feature until
an upstream schema or external trust authority becomes available.

## Remaining reality gates

### 1. Real-hardware Golden Proof

The software entrypoint is closed: live APPLY reaches WindowPilot through
`runDecisionProposal()`, then seals physical truth, physical completion and safe
closeout into the retained proof bundle.

The unresolved gate is only:

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
-> separate GitHub/Sigstore provenance attestation
```

No additional synthetic abstraction work should be credited toward this gate.

### 2. Authorization Trust Domain and optional issuer identity

The current SpatialRuntime authorization receipt proves internal integrity and
application binding, not externally governed transaction trust.

The next valid transition is:

```text
trusted deployment/runtime configuration
-> Trust Domain + signing-key/JWKS source
-> externally validated short-lived Transaction Token / workload identity
-> immutable validated-claims envelope
-> optional issuer check only when the deployment profile pins an issuer
-> FlyThink physical-action binding profile
-> execution boundary
```

FlyThink must not create `flythink-signature-v1`, revive a project-specific HMAC
scheme, or require `iss` merely to make this row look closed.

### 3. Independent object-level observation

The current completion rail can prove that fresh identified readback satisfied a
precommitted criterion under FlyThink's execution semantics. It does not establish
failure-domain / observer independence.

The next valid transition is:

```text
separately trusted object-level observer
-> exact action / target binding
-> fresh observation window
-> explicit observer-independence trust decision
-> retained object-outcome evidence
-> independent_object_outcome_verified = true
```

Until such an observer path exists, integrated WindowPilot state readback remains
useful completion evidence but must not be promoted into independent object truth.

### 4. Real compensation proof

Undo is code-closed at L3. Promotion requires a real execution bundle from which
compensation is derived, a fresh authorization, a physical compensating write,
and retained verification of the resulting state.

### 5. Real multi-device atomic proof

The runtime contract is closed. Promotion requires a retained physical run showing
all intended writes/readbacks and no partial-success claim when the atomic set
cannot be established.

### 6. L5b independent dependency

Cross-repository consumption under the same owner is L5a, not L5b. AER-1 citation
is external standards feedback, but citation is still not dependency.

L5b requires a separately owned repository, host, verifier or CI that pins and
runs a FlyThink contract because it solves that project's own problem.

## External identity evidence already achieved

AER-1 is an individual Internet-Draft, not an IETF-endorsed standard. Its
`draft-zambo-aer1-14` Implementation Status nevertheless publicly records
FlyThink as an independent builder that published a four-case fixture binding
AER-1 execution receipts to physical-completion claims.

That is a real external citation/standards-feedback credential. It must not be
upgraded into an adoption or standards-status claim.

## Stop rule

Do not add a new model, schema, receipt type or research branch unless it does
at least one of the following:

1. moves a row across a maturity boundary;
2. exposes a falsifiable external interoperability gap;
3. converts external citation into conformance/downstream dependency;
4. supplies retained real-world evidence for an existing reality gate; or
5. replaces a project-specific trust mechanism with an externally governed one.

Everything else is lower-value than closing one of the gates above.
