package flythinktxntoken

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aramase/kontxt/pkg/keys"
	"github.com/aramase/kontxt/pkg/token"
	"github.com/aramase/kontxt/sdk/verify"
)

func expected() ExpectedBinding {
	return ExpectedBinding{
		Issuer:                   "https://tts.example.test",
		Audience:                 "homeai.example.test",
		Subject:                  "operator-42",
		Scope:                    "window:actuate",
		RequestingWorkload:       "spiffe://example.test/ns/home/sa/flythink",
		PatchDigest:              strings.Repeat("a", 64),
		RuntimeRegistryDigest:    strings.Repeat("b", 64),
		WorldSnapshotRevision:    "world-42",
		WorldSnapshotSHA256:      strings.Repeat("c", 64),
		CompletionCriteriaSHA256: strings.Repeat("d", 64),
		ExecutionTargetDigest:    strings.Repeat("e", 64),
	}
}

func txClaims(e ExpectedBinding) token.Claims {
	return token.Claims{
		Issuer:             e.Issuer,
		Audience:           e.Audience,
		Subject:            e.Subject,
		Scope:              e.Scope,
		RequestingWorkload: e.RequestingWorkload,
		TransactionContext: map[string]any{
			"flythink": map[string]any{
				"patch_digest":               e.PatchDigest,
				"runtime_registry_digest":    e.RuntimeRegistryDigest,
				"world_snapshot_revision":    e.WorldSnapshotRevision,
				"world_snapshot_sha256":      e.WorldSnapshotSHA256,
				"completion_criteria_sha256": e.CompletionCriteriaSHA256,
				"execution_target_digest":    e.ExecutionTargetDigest,
			},
		},
	}
}

func setup(t *testing.T, audience string) (*keys.Manager, *verify.Verifier) {
	t.Helper()
	manager, err := keys.NewManager(2048, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(manager.JWKSHandler())
	t.Cleanup(server.Close)
	return manager, verify.New(server.URL, audience)
}

func issue(t *testing.T, manager *keys.Manager, claims token.Claims, lifetime time.Duration) string {
	t.Helper()
	key, kid := manager.SigningKey()
	raw, err := token.New(claims, key, kid, lifetime)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestRealKontxtVerifierPlusFlyThinkBindingPasses(t *testing.T) {
	e := expected()
	manager, verifier := setup(t, e.Audience)
	raw := issue(t, manager, txClaims(e), time.Minute)

	out := VerifyAndBind(context.Background(), verifier, raw, e)

	if !out.CryptographicValidationVerified ||
		!out.IssuerAuthenticatedVerified ||
		!out.RequiredClaimsVerified ||
		!out.FlyThinkProfileBindingVerified ||
		!out.ReadyForAuthorizationTrust {
		t.Fatalf("unexpected verdict: %+v", out)
	}
	if out.TokenSHA256 == "" {
		t.Fatal("token hash missing")
	}
}

func TestKontxtCryptoSuccessDoesNotBypassIssuerBinding(t *testing.T) {
	e := expected()
	manager, verifier := setup(t, e.Audience)
	claims := txClaims(e)
	claims.Issuer = "https://other-issuer.example.test"
	raw := issue(t, manager, claims, time.Minute)

	out := VerifyAndBind(context.Background(), verifier, raw, e)

	if !out.CryptographicValidationVerified {
		t.Fatalf("expected Kontxt crypto verification to pass: %+v", out)
	}
	if out.IssuerAuthenticatedVerified || out.ReadyForAuthorizationTrust {
		t.Fatalf("issuer mismatch was promoted: %+v", out)
	}
	if out.FailureStage != "issuer_binding" {
		t.Fatalf("wrong failure stage: %+v", out)
	}
}

func TestKontxtCryptoSuccessDoesNotBypassFlyThinkTctxBinding(t *testing.T) {
	e := expected()
	manager, verifier := setup(t, e.Audience)
	claims := txClaims(e)
	claims.TransactionContext["flythink"].(map[string]any)["patch_digest"] =
		strings.Repeat("f", 64)
	raw := issue(t, manager, claims, time.Minute)

	out := VerifyAndBind(context.Background(), verifier, raw, e)

	if !out.CryptographicValidationVerified || !out.IssuerAuthenticatedVerified {
		t.Fatalf("external verification unexpectedly failed: %+v", out)
	}
	if out.FlyThinkProfileBindingVerified || out.ReadyForAuthorizationTrust {
		t.Fatalf("tctx mismatch was promoted: %+v", out)
	}
	if out.FailureStage != "flythink_tctx_binding" {
		t.Fatalf("wrong failure stage: %+v", out)
	}
}

func TestMissingTctxRemainsBlockedAfterValidSignature(t *testing.T) {
	e := expected()
	manager, verifier := setup(t, e.Audience)
	claims := txClaims(e)
	claims.TransactionContext = nil
	raw := issue(t, manager, claims, time.Minute)

	out := VerifyAndBind(context.Background(), verifier, raw, e)

	if !out.CryptographicValidationVerified || !out.IssuerAuthenticatedVerified {
		t.Fatalf("external verification unexpectedly failed: %+v", out)
	}
	if out.ReadyForAuthorizationTrust || out.FailureStage != "flythink_tctx_binding" {
		t.Fatalf("missing tctx was promoted: %+v", out)
	}
}

func TestWrongAudienceFailsInKontxtBeforeFlyThinkProfile(t *testing.T) {
	e := expected()
	manager, verifier := setup(t, e.Audience)
	claims := txClaims(e)
	claims.Audience = "other.example.test"
	raw := issue(t, manager, claims, time.Minute)

	out := VerifyAndBind(context.Background(), verifier, raw, e)

	if out.CryptographicValidationVerified || out.ReadyForAuthorizationTrust {
		t.Fatalf("wrong audience passed external verifier: %+v", out)
	}
	if out.FailureStage != "external_token_verification" {
		t.Fatalf("wrong failure stage: %+v", out)
	}
}

func TestExpiredTokenFailsInKontxtBeforeFlyThinkProfile(t *testing.T) {
	e := expected()
	manager, verifier := setup(t, e.Audience)
	raw := issue(t, manager, txClaims(e), -time.Second)

	out := VerifyAndBind(context.Background(), verifier, raw, e)

	if out.CryptographicValidationVerified || out.ReadyForAuthorizationTrust {
		t.Fatalf("expired token passed external verifier: %+v", out)
	}
	if out.FailureStage != "external_token_verification" {
		t.Fatalf("wrong failure stage: %+v", out)
	}
}
