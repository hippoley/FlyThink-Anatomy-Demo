from __future__ import annotations

import asyncio
import base64
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from scripts.txn_token_physical_action_profile import (
    PROFILE,
    TransactionTokenBindingError,
    verify_with_authgent,
)


ISSUER = "https://tts.example.test"
AUDIENCE = "physical.trust-domain.example"
KID = "test-es256-key"


def b64url_uint(value: int) -> str:
    raw = value.to_bytes(32, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
PUBLIC = PRIVATE_KEY.public_key().public_numbers()
JWK = {
    "kty": "EC",
    "crv": "P-256",
    "kid": KID,
    "use": "sig",
    "alg": "ES256",
    "x": b64url_uint(PUBLIC.x),
    "y": b64url_uint(PUBLIC.y),
}


class StaticJWKS:
    async def get_key(self, kid: str):
        if kid != KID:
            raise KeyError(kid)
        return JWK


def binding(**overrides):
    row = {
        "profile": PROFILE,
        "patch_digest": "a" * 64,
        "runtime_registry_digest": "b" * 64,
        "world_snapshot_revision": 17,
        "world_snapshot_sha256": "c" * 64,
        "completion_criteria_sha256": "d" * 64,
        "execution_target_digest": "e" * 64,
    }
    row.update(overrides)
    return row


def token(
    *,
    signed_binding=None,
    audience=AUDIENCE,
    issuer=ISSUER,
    exp_offset=120,
    typ="txntoken+jwt",
    scope="flythink.physical.execute home.control",
    txn="txn-001",
    req_wl="spiffe://example.test/workload/gateway",
    key=PRIVATE_KEY,
):
    now = int(time.time())
    claims = {
        "iss": issuer,
        "sub": "user:alice",
        "aud": audience,
        "iat": now,
        "exp": now + exp_offset,
        "txn": txn,
        "req_wl": req_wl,
        "scope": scope,
        "tctx": {
            "flythink": signed_binding if signed_binding is not None else binding(),
            "other_app": {"trace": "opaque-to-flythink"},
        },
    }
    return jwt.encode(
        claims,
        key,
        algorithm="ES256",
        headers={"kid": KID, "typ": typ},
    )


def verify(raw, **kwargs):
    return asyncio.run(
        verify_with_authgent(
            raw,
            issuer=ISSUER,
            audience=AUDIENCE,
            expected_binding=binding(),
            jwks_fetcher=StaticJWKS(),
            validator_source_commit="8341cf932c9816dc666f2a6577b6776bd6f3b978",
            **kwargs,
        )
    )


def test_real_authgent_verifier_then_flythink_binding_passes():
    out = verify(token())
    assert out["validator"]["implementation"] == "authgent"
    assert out["validator"]["source_commit"] == "8341cf932c9816dc666f2a6577b6776bd6f3b978"
    assert out["verification"]["external_token_verified"] is True
    assert out["verification"]["authorization_issuer_authenticated_verified"] is True
    assert out["verification"]["transaction_context_binding_verified"] is True
    assert out["verification"]["txn_single_use_verified"] is False
    assert out["verification"]["ready_for_canonical_execution"] is False


def test_bad_signature_is_rejected_by_external_validator():
    other = ec.generate_private_key(ec.SECP256R1())
    with pytest.raises(TransactionTokenBindingError, match="external_transaction_token_validation_failed"):
        verify(token(key=other))


def test_wrong_audience_is_rejected_by_external_validator():
    with pytest.raises(TransactionTokenBindingError, match="external_transaction_token_validation_failed"):
        verify(token(audience="other.example"))


def test_expired_token_is_rejected_by_external_validator():
    with pytest.raises(TransactionTokenBindingError, match="external_transaction_token_validation_failed"):
        verify(token(exp_offset=-1))


def test_wrong_typ_is_rejected_after_signature_verification():
    with pytest.raises(TransactionTokenBindingError, match="transaction_token_typ_invalid"):
        verify(token(typ="JWT"))


@pytest.mark.parametrize("field", [
    "patch_digest",
    "runtime_registry_digest",
    "world_snapshot_revision",
    "world_snapshot_sha256",
    "completion_criteria_sha256",
    "execution_target_digest",
])
def test_every_physical_binding_field_is_exact(field):
    bad = binding()
    bad[field] = 18 if field == "world_snapshot_revision" else "f" * 64
    with pytest.raises(TransactionTokenBindingError, match=f"flythink_tctx_{field}_mismatch"):
        verify(token(signed_binding=bad))


def test_missing_required_physical_scope_is_rejected():
    with pytest.raises(TransactionTokenBindingError, match="physical_execution_scope_required"):
        verify(token(scope="home.control"))


def test_missing_transaction_identifier_is_rejected():
    with pytest.raises(TransactionTokenBindingError, match="txn_required"):
        verify(token(txn=""))


def test_missing_requesting_workload_is_rejected():
    with pytest.raises(TransactionTokenBindingError, match="req_wl_required"):
        verify(token(req_wl=""))


def test_unknown_flythink_profile_field_fails_closed():
    bad = binding()
    bad["future_semantics"] = True
    with pytest.raises(TransactionTokenBindingError, match="flythink_tctx_fields_invalid"):
        verify(token(signed_binding=bad))


def test_tampering_signed_tctx_breaks_signature_before_binding():
    raw = token()
    header, payload, signature = raw.split(".")
    decoded = bytearray(base64.urlsafe_b64decode(payload + "=="))
    # Any byte mutation in signed payload must fail external verification.
    decoded[-2] ^= 1
    tampered_payload = base64.urlsafe_b64encode(bytes(decoded)).rstrip(b"=").decode()
    tampered = ".".join((header, tampered_payload, signature))
    with pytest.raises(TransactionTokenBindingError, match="external_transaction_token_validation_failed"):
        verify(tampered)
