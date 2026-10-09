# Claim-Scope-Preserving Execution Evidence

Status: research crosswalk / interoperability note  
Last reviewed: 2026-10-08

FlyThink should not become another universal "AI action receipt" format.

The stronger position is narrower:

> Combine evidence across authority, agent tooling, telemetry and physical execution
> **without promoting any source beyond the claim it can actually support.**

This note maps several emerging 2026 receipt / observability surfaces and freezes
the interoperability rule FlyThink should follow when crossing those boundaries.

## The recurring mistake

A signed or hash-verified record is often accidentally treated as stronger evidence
than it is.

Examples:

- an authorization decision is presented as proof that execution occurred;
- a tool-call trace is presented as proof that the external world changed;
- a gateway-observed action is presented as proof that a physical actuator reached
  the requested state;
- a physical engagement record is presented as proof that the action was safe,
  correct, legal or beneficial;
- a timeout or driver exception is presented as proof that no physical effect
  occurred.

FlyThink's intended role is to prevent that kind of claim laundering across the
agent-to-reality boundary.

## Current landscape

| Surface | Primary claim | Explicit / practical non-claim | Useful FlyThink relation |
| --- | --- | --- | --- |
| OpenTelemetry GenAI `execute_tool` | a tool execution operation was observed and instrumented | telemetry does not itself prove an external side effect | attach trace/span identity as provenance; never treat span success as physical truth |
| AER-1 (draft-zambo-aer1) | one agent tool execution was recorded with canonical bytes, an output commitment, timing, tool identity and provenance class | the receipt proves what the recording system observed and committed; it does not independently prove outside-world effects beyond that observation | correlate the AER receipt identity / output commitment with FlyThink physical evidence while preserving AER provenance and FlyThink's independent Context/World/authorization claims |
| Agent Passport System `aps:action:v1` | gateway observed an action issued under a delegation chain | explicitly does not prove off-protocol side-effect completion | APS can own authority/accountability evidence while FlyThink owns physical execution evidence |
| SCITT Physical-Site Engagement Receipt (PSER) | signed, tamper-evident record that an engagement occurred at a site under an operating envelope, with attestation | explicitly does not claim the engagement was safe/correct/wise or that downstream outcome followed | PSER can anchor site/actor/envelope/attestation; FlyThink can provide action/readback-level execution evidence |
| FlyThink `execution-receipt.v1` | the execution evidence graph binds exact context/world identity, authorization, physical command evidence and measured readback | does not prove broad safety, legal compliance, business correctness or facts beyond the observed physical evidence | canonical execution-truth object |
| FlyThink `execution-proof-bundle.v1` | portable envelope binds DecisionProposal + context + runtime + canonical execution receipt for offline verification | bundle does not create a second truth authority | cross-system transport / independent verification surface |

## Mapping to IETF RATS / EAT

FlyThink should reuse the attestation architecture vocabulary rather than invent
a parallel trust model.

RFC 9334 separates four important concepts:

- **Evidence**: claims produced by an Attester for appraisal;
- **Verifier**: appraises Evidence under an appraisal policy;
- **Attestation Result**: verifier output for downstream use;
- **Relying Party**: decides whether to trust / authorize based on Attestation Results.

RFC 9711 (EAT) provides a Standards Track token format for attested claims about
the state and characteristics of an entity/device.

A useful non-normative mapping is:

| FlyThink object / role | RATS/EAT interpretation | Boundary that must remain explicit |
| --- | --- | --- |
| measured readback, hardware identity, ACK/readback timing, authorization receipt | candidate **Evidence** inputs | raw evidence is not yet a relying-party trust decision |
| `verifyExecutionReceipt()` / `verifyExecutionProofBundle()` | **Verifier**-like appraisal function | verification applies FlyThink-specific appraisal rules; it does not become universal policy |
| derived `physical_truth_verified`, `INDETERMINATE`, mismatch/failure reasons | **Attestation Result**-like output | result describes execution evidence, not broad safety/legal/business correctness |
| external consumer / controller / governance system | **Relying Party** | relying party owns the final policy decision and may require additional evidence |
| PSER / EAT hardware/site attestation | additional attested claims / evidence source | hardware/site trust does not replace per-action physical-effect evidence |

This mapping is intentionally architectural, not a wire-format claim. FlyThink does
not claim to emit an RFC 9711 EAT today, and it should not wrap receipts in EAT
unless an interoperability requirement proves that useful.

The durable design rule is:

```text
execution evidence
    -> appraisal
    -> execution attestation result
    -> relying-party policy decision
```

Do not collapse those steps. In particular, `physical_truth_verified=true` is an
execution-evidence conclusion, not permission for a relying party to skip its own
risk, safety, policy, or compliance checks.
## Interoperability rule

A bridge MUST preserve claim scope.

For two evidence artifacts A and B:

1. verify A under A's own rules;
2. verify B under B's own rules;
3. bind them by explicit stable identities or digests;
4. keep each artifact's authority separate;
5. derive only the intersection / composition of verified claims;
6. never infer a claim that neither artifact independently establishes.

In particular:

```text
authorization verified
!= execution verified

tool call observed
!= physical effect verified

physical effect verified
!= action was properly delegated

physical engagement recorded
!= engagement was safe or correct
```

## Required outcome vocabulary

Physical execution cannot safely collapse into binary success/failure.

At minimum, a consumer must be able to preserve:

```text
VERIFIED_EXECUTED
VERIFIED_NOT_EXECUTED
INDETERMINATE
```

`INDETERMINATE` is required when FlyThink has entered a potentially side-effecting
driver call but lacks sufficient evidence to establish whether the physical effect
occurred.

A bridge MUST NOT translate `INDETERMINATE` into success or non-execution merely to
fit a simpler downstream schema.

## Proposed interop experiments

These are experiments, not compatibility claims.

### 1. APS authority + FlyThink physical execution

```text
APS ActionReceipt / AuthorityBoundaryReceipt
  -> explicit action correlation
FlyThink decision-proposal.v1
  -> physical execution
FlyThink execution-proof-bundle.v1
```

Success means a verifier can independently establish both:

- authority/accountability evidence verified under APS semantics;
- physical execution evidence verified under FlyThink semantics.

Failure of either side must not be hidden by the other.

### 2. AER-1 observed execution record + FlyThink physical evidence

AER-1 draft-14 keeps a deliberately narrow interoperable core: a receipt records
one tool execution as observed by the recording system, binds the exact canonical
bytes with an output commitment, and carries a provenance class.

It does **not** make an outside-world claim merely because the receipt verifies.
`EXECUTED BY <implementation>`, `OBSERVED VIA GATEWAY`, and `LOGGED BY AGENT`
describe different provenance, but verification MUST NOT upgrade a report or
gateway observation into independently established physical truth.

That makes the useful FlyThink interoperability question:

```text
AER-1 receipt
  receipt id
  canonical bytes + output commitment
  tool metadata
  provenance class
        |
        | explicit correlation only
        v
FlyThink physical completion evidence
  exact Context + World identity
  authorization-bound completion criterion
  identified/fresh physical witness
  VERIFIED / NOT_SATISFIED / INDETERMINATE
```

The bridge must preserve both claim scopes:

- a valid AER receipt does not imply FlyThink physical completion;
- verified physical completion does not repair an invalid AER receipt;
- AER provenance remains AER provenance and must not be rewritten by FlyThink;
- FlyThink's Context/World/authorization chain remains independently verified;
- missing or stale physical evidence may remain `INDETERMINATE` without
  invalidating the AER receipt itself.

This experiment is no longer only proposed: `draft-zambo-aer1-14` records the
FlyThink four-case fixture in Implementation Status. The same draft also states
the broader rule that binding records together does not transfer one record's
claims to another. That is external standards feedback for this research
boundary; it is not IETF endorsement or downstream dependency on FlyThink.

### 3. OpenTelemetry trace + FlyThink proof

OpenTelemetry should remain the observability plane.

FlyThink may attach:

- trace id;
- span id;
- `execute_tool` operation identity;

as provenance references, but an OpenTelemetry span status must never replace
receipt verification or measured readback.

### 4. PSER + FlyThink

A PSER can provide a stronger site / actor / engagement-envelope / hardware
attestation context.

FlyThink can provide finer-grained per-action evidence:

```text
site + actor + envelope + TEE attestation
                 +
semantic/world identity + authorization + actuator ACK + measured readback
```

A combined verifier must still retain both non-claims:

- engagement attestation is not a safety verdict;
- measured execution is not a legal / policy / business verdict.

## Why this is a durable research position

The direction is intentionally model-independent.

A better LLM can improve planning, reasoning or action selection, but it cannot
remove the need to distinguish:

- what was proposed;
- what authority allowed;
- what exact world/context identity the decision referred to;
- what side-effecting boundary was crossed;
- what was actually observed;
- what remains unknowable;
- which external verifier can reproduce the claim.

As agent autonomy grows, the cost of confusing those layers increases.

## FlyThink non-goals

Do not:

- define a universal identity system;
- replace delegation / governance protocols;
- replace OpenTelemetry;
- claim compatibility from similar field names;
- treat signatures or hashes as proof of external reality;
- synthesize upstream context/world identity inside FlyThink;
- invent a new receipt type when an explicit crosswalk is sufficient.

## Public test for this position

FlyThink has reached a stronger ecosystem position only when a non-FlyThink
implementation can consume a retained fixture and independently derive the same
claim classification while preserving both sides' non-claims.

The progression to target is:

```text
crosswalk
-> frozen fixture
-> independent verifier run
-> external adapter / example
-> downstream CI dependency
```

Until then, this document is a research map and invitation to interoperate, not
evidence of adoption.

## References

- OpenTelemetry GenAI semantic conventions — execute tool spans:
  https://github.com/open-telemetry/semantic-conventions-genai
- AER-1, draft-zambo-aer1:
  https://datatracker.ietf.org/doc/draft-zambo-aer1/
- SCITT Physical-Site Engagement Receipt:
  https://datatracker.ietf.org/doc/draft-wilder-scitt-physical-site-engage-receipt/
- Agent Passport System:
  https://github.com/agent-passport-system/agent-passport-system
- FlyThink:
  https://github.com/hippoley/FlyThink-Anatomy-Demo