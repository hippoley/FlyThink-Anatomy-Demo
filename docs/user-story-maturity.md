# User-story maturity map

This file is the repository's internal truth table for what FlyThink can claim today.
It exists to prevent research-playground features, deterministic contracts, canonical
execution paths and real-world evidence from being described at the same maturity level.

## Maturity levels

- **L0 — Research/UI only:** useful for exploration; not a stable backend claim.
- **L1 — Deterministic contract:** schema/patch behavior is specified and tested.
- **L2 — Canonical runtime:** the behavior is wired into the durable execution path.
- **L3 — Physical evidence:** real driver/readback semantics are exercised with fail-closed behavior.
- **L4 — Retained external evidence:** a frozen artifact can be independently replayed later.
- **L5 — External consumption:** a non-FlyThink project/verifier/CI actually consumes or depends on it.

## Whole-home user stories

| User story | Current level | Evidence | Remaining closure |
| --- | --- | --- | --- |
| Add a new device / target | L2 | `ADD_DEVICE`, whole-home contract + canonical runtime | Real multi-device hardware evidence only if claimed physically |
| Set one slot without touching other state | L3 | `PATCH_SLOT`, untouched-state invariant, physical runtime | Golden hardware artifact |
| Relative adjustment | L3 | `PATCH_RELATIVE`, binding tests, physical runtime, now frozen whole-home acceptance | Golden hardware artifact for a relative physical actuation if we want that public claim |
| Close without removing state | L3 | `CLOSE_DEVICE`, physical runtime | Golden hardware artifact |
| Remove from persistent control state | L2 | `REMOVE_DEVICE` | Keep separate from physical close semantics; no device-grounding claim |
| Replace a target after correction | L2 | `REPLACE_TARGET`, explicit-replacement corpus/tests | Semantic interpretation belongs upstream in NLUSLOT |
| Cancel a pending action | L2 | `CANCEL_PENDING`; pending namespace is distinct from device state | End-to-end upstream semantic trigger remains NLUSLOT-owned |
| Undo an already executed action | L2/L3 | `UNDO_EXECUTED` requires explicit compensation; recovery/physical paths exist | Real compensated hardware artifact if claiming physical undo |
| Protect 'keep unchanged' state | L2 | `PROTECT` + protected invariant enforcement | Keep semantic detection upstream; runtime enforcement is closed |
| Multi-target / set operation | L3 | canonical runtime requires atomic multi-target capability + readback; no sequential fallback | Real hardware atomic-batch evidence across >1 device |
| Pronoun/coreference / correction / clarification | External owner | NLUSLOT owns `contextual-state.v1`; FlyThink consumes exact identity | Do not rebuild semantic ownership here |
| Interruption / resume / long dialogue | L0/L1 in this repo | browser/research surfaces and corpora | Durable semantic ownership belongs NLUSLOT; FlyThink should only test execution handoff |

## Execution-truth user stories

| User story | Current level | Remaining closure |
| --- | --- | --- |
| Untrusted reasoner proposes an action without direct actuator access | L2 | none |
| Exact Context + World identities are bound to execution | L2 | none |
| SpatialRuntime authorization is re-verified at the execution boundary | L2 | none |
| Authorization cannot be replayed silently | L2 | persistent ledger required |
| Potential side effect with ambiguous transport outcome remains `INDETERMINATE` | L3 | real lost-ACK hardware evidence would strengthen the claim |
| Physical truth requires ACK/readback/identity checks | L3 | retained Golden Proof |
| Physical completion requires criterion fixed before actuation + identified/fresh witness | L3 | retained Golden Proof |
| Third party can verify retained evidence offline | L4 for synthetic/frozen fixtures; L3 for real hardware | real hardware Golden Proof still pending |
| External system actually depends on verifier rail / proof bundle | L5 not yet achieved | needs non-FlyThink run / CI / dependency |

## Intentionally blocked, not 'unfinished by accident'

- Service execution inputs and nested-value schemas are blocked because the compact capability
  index does not carry enough schema detail to validate them safely.
- Event capabilities are not treated as commands.
- FlyThink does not own persistent semantic conversation/task truth; NLUSLOT does.
- A successful authorization or EVC decision is not proof of physical completion.

## Current reality gates

1. **Real-hardware Golden Proof:** protected live workflow must produce a retained canonical
   `execution-receipt.v1` + `execution-proof-bundle.v1`, independently verify physical truth
   and completion, and retain safe closeout evidence.
2. **External verifier consumption:** at least one non-FlyThink implementation or conformance
   harness must run the verifier/fixture and publish a result.
3. **Standards feedback:** AER/Probity/EVC/adjacent nodes count only when a third party reviews,
   requests changes, cites, runs, or adopts the artifact.

## Scope discipline

New work should raise one of the maturity levels above. A new research artifact that does not
move a user story from L0→L1, L1→L2, L2→L3, L3→L4 or L4→L5 is normally lower priority than
closing an existing reality gate.