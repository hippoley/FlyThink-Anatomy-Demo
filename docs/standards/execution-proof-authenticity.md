# Execution proof authenticity boundary

Status: canonical claim-scope guidance for retained Golden Proof evidence.

FlyThink intentionally separates three independent questions:

1. **Evidence integrity and semantics** — can the retained proof bundle be re-verified and can its physical-effect claims be recomputed?
2. **Issuer / workflow provenance** — can a relying party verify which trusted workflow identity produced the retained proof bundle?
3. **Transparency / non-equivocation** — can a relying party verify that the signed statement was registered in a transparency system with the consistency properties required by that system?

The three questions must not be collapsed into one "verified" bit.

## Layer 1 — FlyThink proof bundle

`execution-proof-bundle.v1` binds the decision proposal, contextual state, execution request, internal proposal, runtime snapshots and canonical `execution-receipt.v1`.

The canonical verifier can currently derive, among other fields:

```text
physical_truth_verified
physical_completion_verified
safe_closeout_verified
```

These are evidence/semantic claims. They do not authenticate an issuer merely because all SHA-256 commitments recompute correctly.

A party that can construct a self-consistent object can also compute its hashes. Therefore:

```text
hash integrity != issuer authenticity
```

## Layer 2 — GitHub / Sigstore artifact attestation

The protected physical-lab workflow separately runs `actions/attest@v4` with `live-execution-proof-bundle.json` as the attestation subject and retains the generated Sigstore bundle as part of the Golden Proof candidate artifact.

This layer is deliberately outside the FlyThink JSON proof format.

It can establish workflow/repository provenance for the exact proof-bundle artifact when verified against the appropriate GitHub/Sigstore trust roots.

Typical online verification:

```bash
gh attestation verify live-execution-proof-bundle.json \
  -R hippoley/FlyThink-Anatomy-Demo
```

GitHub also documents offline verification using a retained attestation bundle and an explicit trusted-root snapshot.

A Sigstore provenance attestation does **not** replace FlyThink's physical verifier. It authenticates provenance of the subject artifact; it does not, by itself, prove that a window moved or a completion criterion was satisfied.

## Layer 3 — SCITT transparency

FlyThink does not currently claim that its proof bundle is an RFC 9943 SCITT Signed Statement or that it has a SCITT Transparency Receipt.

The emerging SCITT AI-Agent Action Receipt profile explicitly distinguishes:

- issuer-authenticated signed action records;
- Transparency Service registration;
- downstream-controller outcome;
- physical completion.

FlyThink should compose with those layers rather than invent a competing signature or transparency protocol.

In particular, a GitHub/Sigstore artifact attestation must not be relabeled as a SCITT Transparency Receipt, and successful SCITT registration would still not make a physical-effect claim true.

## Golden Proof acceptance

A retained physical-lab artifact may be called a **Golden Proof candidate** only when the FlyThink bundle verifier returns:

```text
physical_truth_verified = true
physical_completion_verified = true
safe_closeout_verified = true
```

A stronger **provenance-authenticated Golden Proof** additionally requires the retained Sigstore attestation bundle to verify for the exact `live-execution-proof-bundle.json` subject under the expected repository / workflow identity.

This still does not claim SCITT registration, transparency-log non-equivocation, named-human approval, legality, safety or business correctness.

## Long-term direction

Do not introduce `flythink-signature-v1`.

Prefer adapters to mature trust layers:

```text
FlyThink execution-proof-bundle.v1
  -> in-toto / Sigstore artifact provenance
  -> optional SCITT Signed Statement / Transparency Service bridge
```

The durable asset is the evidence and claim-separation contract, not a project-specific cryptographic envelope.
