#!/usr/bin/env python3
"""Experimental Txn-Token -> FlyThink physical-action binding adapter.

Trust boundary:
- authgent verifies JWS signature + issuer + audience + expiry;
- this module verifies only the signed application context under tctx.flythink;
- this module does not mint tokens, fetch signing keys itself, or authorize an
  actuator write by itself.

The output is an issuer-authenticated *input evidence envelope*. It is not yet a
canonical FlyThink execution authorization because transaction single-use must
still be bound to the execution-time replay ledger.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Any

PROFILE = "flythink-physical-action-binding.v0"
ENVELOPE_SCHEMA = "flythink-validated-txn-context.v0"
REQUIRED_SCOPE = "flythink.physical.execute"
DIGEST_FIELDS = (
    "patch_digest",
    "runtime_registry_digest",
    "world_snapshot_sha256",
    "completion_criteria_sha256",
    "execution_target_digest",
)
BINDING_FIELDS = (
    "profile",
    "patch_digest",
    "runtime_registry_digest",
    "world_snapshot_revision",
    "world_snapshot_sha256",
    "completion_criteria_sha256",
    "execution_target_digest",
)
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class TransactionTokenBindingError(ValueError):
    pass


def _canonical(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _canonical(value[k]) for k in sorted(value)}
    if isinstance(value, list):
        return [_canonical(v) for v in value]
    return value


def digest_object(value: Any) -> str:
    raw = json.dumps(
        _canonical(value),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _validate_expected_binding(expected: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(expected, dict):
        raise TransactionTokenBindingError("expected_binding_required")
    if set(expected) != set(BINDING_FIELDS):
        raise TransactionTokenBindingError("expected_binding_fields_invalid")
    if expected.get("profile") != PROFILE:
        raise TransactionTokenBindingError("expected_binding_profile_invalid")
    revision = expected.get("world_snapshot_revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        raise TransactionTokenBindingError("world_snapshot_revision_invalid")
    for field in DIGEST_FIELDS:
        if not _SHA256.fullmatch(str(expected.get(field) or "")):
            raise TransactionTokenBindingError(f"{field}_invalid")
    return json.loads(json.dumps(expected))


def _scope_set(claims: dict[str, Any]) -> set[str]:
    raw = claims.get("scope")
    if not isinstance(raw, str):
        return set()
    return {x for x in raw.split() if x}


def validate_signed_application_context(
    claims: dict[str, Any],
    *,
    expected_binding: dict[str, Any],
    required_scope: str = REQUIRED_SCOPE,
) -> dict[str, Any]:
    """Validate application semantics after external JWT verification."""
    expected = _validate_expected_binding(expected_binding)

    txn = claims.get("txn")
    if not isinstance(txn, str) or not txn:
        raise TransactionTokenBindingError("txn_required")

    req_wl = claims.get("req_wl")
    if not isinstance(req_wl, str) or not req_wl:
        raise TransactionTokenBindingError("req_wl_required")

    if required_scope not in _scope_set(claims):
        raise TransactionTokenBindingError("physical_execution_scope_required")

    tctx = claims.get("tctx")
    if not isinstance(tctx, dict):
        raise TransactionTokenBindingError("tctx_required")
    supplied = tctx.get("flythink")
    if not isinstance(supplied, dict):
        raise TransactionTokenBindingError("flythink_tctx_required")

    # Fail closed on unknown fields inside the FlyThink profile. Other
    # application namespaces may coexist beside tctx.flythink.
    if set(supplied) != set(BINDING_FIELDS):
        raise TransactionTokenBindingError("flythink_tctx_fields_invalid")

    if supplied.get("profile") != PROFILE:
        raise TransactionTokenBindingError("flythink_tctx_profile_invalid")

    for field in BINDING_FIELDS:
        if supplied.get(field) != expected.get(field):
            raise TransactionTokenBindingError(f"flythink_tctx_{field}_mismatch")

    return {
        "txn": txn,
        "req_wl": req_wl,
        "subject": claims.get("sub"),
        "scope": sorted(_scope_set(claims)),
        "flythink_binding": expected,
        "tctx_sha256": digest_object(tctx),
    }


async def verify_with_authgent(
    token: str,
    *,
    issuer: str,
    audience: str,
    expected_binding: dict[str, Any],
    jwks_fetcher: Any = None,
    required_scope: str = REQUIRED_SCOPE,
    validator_source_commit: str | None = None,
) -> dict[str, Any]:
    """Verify a Txn-Token using authgent, then verify FlyThink tctx binding.

    authgent owns JWS/iss/aud/exp validation. FlyThink intentionally performs
    no fallback JWT verification.
    """
    if not token:
        raise TransactionTokenBindingError("transaction_token_required")
    if not issuer:
        raise TransactionTokenBindingError("issuer_required")
    if not audience:
        raise TransactionTokenBindingError("audience_required")

    try:
        import jwt
        from authgent import verify_token
    except Exception as exc:  # pragma: no cover - dependency contract
        raise RuntimeError("authgent_validator_dependency_required") from exc

    try:
        identity = await verify_token(
            token=token,
            issuer=issuer,
            audience=audience,
            jwks_fetcher=jwks_fetcher,
        )
    except Exception as exc:
        raise TransactionTokenBindingError(
            "external_transaction_token_validation_failed"
        ) from exc

    # The JOSE header is signature-covered. Inspect it only after authgent has
    # accepted the signature and standard claims.
    try:
        header = jwt.get_unverified_header(token)
    except Exception as exc:
        raise TransactionTokenBindingError("transaction_token_header_invalid") from exc
    if header.get("typ") != "txntoken+jwt":
        raise TransactionTokenBindingError("transaction_token_typ_invalid")

    claims = identity.claims.raw
    app = validate_signed_application_context(
        claims,
        expected_binding=expected_binding,
        required_scope=required_scope,
    )

    commit = (
        validator_source_commit
        or os.environ.get("AUTHGENT_SOURCE_COMMIT")
        or None
    )
    if commit is not None and not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise TransactionTokenBindingError("validator_source_commit_invalid")

    return {
        "schema_version": ENVELOPE_SCHEMA,
        "validator": {
            "implementation": "authgent",
            "source_commit": commit,
            # Keep this descriptive rather than claiming draft conformance.
            "trust_decisions": ["jws_signature", "issuer", "audience", "expiry"],
        },
        "token": {
            "txn": app["txn"],
            "req_wl": app["req_wl"],
            "subject": app["subject"],
            "scope": app["scope"],
            "tctx_sha256": app["tctx_sha256"],
        },
        "flythink_binding": app["flythink_binding"],
        "verification": {
            "external_token_verified": True,
            "transaction_token_typ_verified": True,
            "transaction_context_binding_verified": True,
            "authorization_issuer_authenticated_verified": True,
            # This adapter intentionally does not own replay state.
            "txn_single_use_verified": False,
            "ready_for_canonical_execution": False,
        },
        "claim_boundary": [
            "external validator owns JWS/issuer/audience/expiry validation",
            "FlyThink owns only the signed tctx.flythink application binding",
            "this envelope is not physical execution evidence",
            "this envelope is not actuator authority until txn single-use is bound at execution time",
        ],
    }


def expected_binding_from_json(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        return _validate_expected_binding(json.load(fh))
