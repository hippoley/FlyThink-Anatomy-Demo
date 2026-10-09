# Claim-scope separation for agent execution evidence

Status: interoperability experiment, not a standards-compliance claim.

Emerging SCITT work on AI-agent action receipts now makes an important distinction:
a receipt recorded at a governed boundary is not automatically evidence that a
controller succeeded or that an intended physical effect occurred.

FlyThink already has the ingredients to preserve those claim boundaries, but until
now the separation lived mostly in prose and verifier internals.

`scripts/claim_scope_report.cjs` exposes the distinction as machine-readable output:

```text
execution record
execution authorization binding
authorization issuer authenticity
controller report
physical effect
```

Each claim has its own status and explicit non-claims.

This is intentionally stricter than a single `success=true` bit. In particular:

- verified authorization **binding** does not imply the authorization issuer was authenticated;
- authorization issuer authenticity does not imply controller success;
- controller ACK does not imply physical completion;
- physical completion requires the existing FlyThink precommitted criterion,
  identified witness, fresh observation and completion checks;
- no layer implies human approval, safety, legality or business correctness.

The current SCITT AI-Agent Action Receipt draft similarly separates governed-boundary
execution from controller-reported outcome and physical completion. FlyThink should
therefore aim for interoperable claim separation, not a competing universal receipt
format.

Example:

```bash
cat verification.json | node scripts/claim_scope_report.cjs
```

This report is suitable as an adapter surface for future receipt / telemetry bridges.
