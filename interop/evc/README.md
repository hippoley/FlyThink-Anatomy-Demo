# EVC adapter for physical-completion preconditions

This adapter lets an EVC v1 host use FlyThink as an external verifier when a
**later privileged action is allowed only if an earlier physical action has
already completed according to a pre-authorized criterion**.

It does not turn physical-completion evidence into general authorization.

## Invocation

```sh
node scripts/evc_physical_completion_verifier.cjs
```

The verifier reads exactly one EVC request object from stdin and writes exactly
one EVC verdict object to stdout.

## Bundle

`bundle` is an opaque JSON string containing a
`flythink.physical-completion-vector.v0.1` object. The host does not inspect it.

The request uses one verifier-specific extension inside EVC's open `request`
object:

```json
{
  "required_precondition": {
    "type": "physical_completion",
    "criterion_sha256": "<authorized criterion digest>"
  }
}
```

The adapter returns `allow` only when:

- the EVC envelope is version 1 and well-formed;
- the physical-completion bundle is valid;
- the host-requested criterion digest equals the authorization-bound criterion;
- the physical appraisal result is `PHYSICAL_COMPLETION_PROVEN`.

All other trustworthy decision outcomes return EVC `deny` with exit status 0.
Only an internal failure that prevents a trustworthy verdict returns non-zero.

## Why this shape

EVC is a pre-action authorization boundary. FlyThink physical-completion evidence
is post-action evidence. The safe composition is therefore a **dependent-action
gate**:

```text
physical action A
  -> witness/readback
  -> FlyThink proves completion criterion C
  -> EVC host prepares privileged action B that requires C
  -> external verifier allow/deny
  -> host fail-closes
```

This preserves both systems' authority: EVC owns the host/verifier transport and
fail-closed decision envelope; FlyThink owns only the physical-completion
appraisal inside the opaque bundle.