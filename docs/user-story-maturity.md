# User-story maturity map

This is the repository truth table for what FlyThink can claim today. It keeps
research-playground features, deterministic contracts, canonical execution,
physical evidence and adoption at different maturity levels.

## Maturity levels

- **L0 — Research/UI only:** useful for exploration; not a stable backend claim.
- **L1 — Deterministic contract:** schema/patch behavior is specified and tested.
- **L2 — Canonical runtime:** behavior is wired into the durable execution path.
- **L3 — Physical evidence:** real driver/readback semantics are exercised fail-closed.
- **L4 — Retained evidence:** a frozen artifact can be verified independently later. Semantic/integrity verification and issuer/workflow provenance are tracked as separate dimensions.
- **L5a — Cross-repository consumption:** a non-FlyThink repository pins and runs the contract in CI.
- **L5b — Independent external adoption:** a separately owned third-party project, verifier or CI depends on it.

L5a is evidence that the interface can survive outside this repository. It is
**not** third-party endorsement. Only L5b counts as independent ecosystem adoption.

## Whole-home user stories

| User story | Current level | Evidence | Remaining closure |
| --- | --- | --- | --- |
| Add a new device / target | L2 | `ADD_DEVICE`, whole-home contract + canonical runtime | real multi-device evidence only if physically claimed |
| Set one slot without touching other state | L3 | `PATCH_SLOT`, untouched-state invariant, physical runtime | retained real-hardware proof |
| Relative adjustment | L3 | `PATCH_RELATIVE`, binding + physical runtime + frozen acceptance | retained relative hardware proof if promoted publicly |
| Close without removing state | L3 | `CLOSE_DEVICE`, physical runtime | retained real-hardware proof |
| Remove from persistent control state | L2 | `REMOVE_DEVICE` | keep distinct from physical close semantics |
| Replace a target after correction | L2 | `REPLACE_TARGET`, explicit-replacement acceptance | semantic interpretation belongs upstream |
| Cancel a pending action | L2 | `CANCEL_PENDING`; pending namespace separate from device state | semantic trigger remains upstream-owned |
| Undo an already executed action | L2/L3 | `UNDO_EXECUTED` requires explicit compensation | real compensated hardware proof if physically claimed |
| Protect keep-unchanged state | L2 | `PROTECT` + invariant enforcement | semantic detection remains upstream |
| Multi-target / set operation | L3 | atomic write-set enforcement + readback | real atomic multi-device evidence |
| Pronoun / coreference / correction / clarification | External owner | contextual-state contract consumed here | do not rebuild semantic ownership here |
| Interruption / resume / long dialogue | L0/L1 here | research/browser corpora | durable semantic ownership remains upstream |

## Execution-truth / conformance user stories

| User story | Current level | Remaining closure |
| --- | --- | --- |
| Untrusted reasoner proposes without actuator authority | L2 | none |
| Exact Context + World identities are bound to execution | L2 | none |
| Authorization is re-verified at execution boundary | L2 | none |
| Potential side effect with ambiguous transport stays `INDETERMINATE` | L3 | real lost-ACK evidence would strengthen the claim |
| Completion requires pre-actuation criterion + fresh identified witness | L3 | retained real-hardware Golden Proof |
| Third party can verify retained evidence offline | L4 for frozen fixtures | real-hardware proof still pending; bundle integrity alone is not issuer authentication |
| Kernel conformance contract is consumable outside FlyThink | L5a | NLUSLOT pins FlyThink commit `d1c3f3619b400153f17731df12a71f0b472ff9fc` and passed cross-repo CI run `37873409257` |
| Independent external system depends on a FlyThink verifier/conformance rail | L5b not achieved | separately owned project / CI / verifier required |

## Intentionally blocked

- Service inputs and nested-value writes remain fail-closed until full schemas can be validated.
- Event capabilities are not commands.
- FlyThink does not own persistent semantic conversation/task truth.
- Authorization success is not physical completion.

## Current reality gates

1. **Golden Proof:** protected live workflow must retain canonical receipt + proof bundle + safe closeout + a separately verifiable Sigstore provenance envelope for the exact proof-bundle artifact.
2. **Independent adoption:** L5a is closed for the kernel conformance rail; L5b still requires a separately owned downstream consumer.
3. **Standards feedback:** external review/citation/adoption counts; self-authored compatibility claims do not.

## Priority rule

New work should move an existing story across a maturity boundary. A new experiment
that moves no boundary is lower priority than closing an existing reality gate.

At the current state, the two highest-value transitions are:

```text
L3 -> L4   retained real-hardware Golden Proof with separate proof + provenance verification
L5a -> L5b independently owned downstream consumer
```
