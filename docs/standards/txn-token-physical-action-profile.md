# Transaction Token physical-action binding profile v0

Status: P1 interoperability experiment. **Not yet canonical actuator authority.**

## Why

`execution-receipt.v1` can verify that a SpatialRuntime authorization receipt
is internally self-consistent and exactly bound to the action/context being
executed. A self-hash cannot authenticate who was entitled to issue that allow
decision.

This experiment composes FlyThink with an external OAuth Transaction Token
validator instead of inventing a FlyThink signing protocol.

## Trust split

```text
raw Txn-Token
  -> authgent verifier
       ES256/JWS
       issuer
       audience / trust domain
       expiry
  -> verified claims
  -> FlyThink profile
       typ == txntoken+jwt
       txn + req_wl present
       physical execution scope present
       exact signed tctx.flythink binding
  -> validated-txn-context.v0
```

FlyThink never receives an issuer private key and does not duplicate the JWS
validation path.

## Application profile

The TTS-authoritative `tctx` contains:

```json
{
  "flythink": {
    "profile": "flythink-physical-action-binding.v0",
    "patch_digest": "<sha256>",
    "runtime_registry_digest": "<sha256>",
    "world_snapshot_revision": 17,
    "world_snapshot_sha256": "<sha256>",
    "completion_criteria_sha256": "<sha256>",
    "execution_target_digest": "<sha256>"
  }
}
```

The `flythink` object is exact/fail-closed: unknown profile fields are rejected
until a new profile revision defines their semantics. Other application
namespaces may coexist beside `tctx.flythink`.

## External implementation evidence

CI checks out and installs the Python SDK from:

```text
authgent/authgent
8341cf932c9816dc666f2a6577b6776bd6f3b978
```

The test path calls authgent's real `verify_token()`; FlyThink does not mock the
signature/issuer/audience/expiry decision.

The pinned authgent tree's `STANDARDS.md` maps its Transaction Token
implementation to draft-ietf-oauth-transaction-tokens rev -11. Some SDK/docstring
text in the same repository still names earlier draft revisions. FlyThink
therefore records the exact source commit and does **not** convert this
integration into a generic "draft-11 conformant" claim.

## Why the envelope is not executable yet

The adapter returns:

```text
authorization_issuer_authenticated_verified = true
txn_single_use_verified = false
ready_for_canonical_execution = false
```

That is intentional. Transaction-token issuer/authenticity evidence and physical
action binding are now externally grounded, but FlyThink must still bind the
`txn` identifier into its durable execution-time replay/single-use ledger before
this evidence can authorize a physical driver call.

The next P1 transition is therefore narrow:

```text
validated-txn-context.v0
  + execution-time txn reservation/consumption
  + exact DecisionProposal/World binding
  -> canonical execution authorization
```

Do not bypass that step by setting the execution-receipt issuer-authentication
flag from caller JSON.
