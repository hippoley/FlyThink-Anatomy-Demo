package flythinktxntoken

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aramase/kontxt/pkg/keys"
	"github.com/aramase/kontxt/pkg/token"
	"github.com/golang-jwt/jwt/v5"
)

func expected() ExpectedBinding {
	return ExpectedBinding{
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

func txClaims(trust TrustAnchor, e ExpectedBinding) token.Claims {
	return token.Claims{
		Issuer:             trust.Issuer,
		Audience:           trust.Audience,
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

func setupTrust(t *testing.T, issuer, audience string) (*keys.Manager, TrustAnchor) {
	t.Helper()
	manager, err := keys.NewManager(2048, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(manager.JWKSHandler())
	t.Cleanup(server.Close)
	return manager, TrustAnchor{
		Issuer:   issuer,
		JWKSURL:  server.URL,
		Audience: audience,
		Source:   "test-pinned-runtime-config",
	}
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

// Kontxt's current token.New() still requires iss even though Transaction Tokens
// draft-11 makes it optional. Build one standards-shaped issuer-less token
// directly so this test exercises the external verifier rather than the
// upstream issuer helper's stricter local policy.
func issueWithoutIssuer(
	t *testing.T,
	manager *keys.Manager,
	trust TrustAnchor,
	e ExpectedBinding,
	lifetime time.Duration,
) string {
	t.Helper()
	key, kid := manager.SigningKey()
	now := time.Now()
	claims := jwt.MapClaims{
		"iat":    now.Unix(),
		"exp":    now.Add(lifetime).Unix(),
		"aud":    trust.Audience,
		"txn":    "issuerless-draft11-transaction",
		"sub":    e.Subject,
		"scope":  e.Scope,
		"req_wl": e.RequestingWorkload,
		"tctx": map[string]any{
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
	rawToken := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	rawToken.Header["typ"] = token.TypeHeader
	rawToken.Header["kid"] = kid
	raw, err := rawToken.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestRealKontxtVerifierPlusFlyThinkBindingPasses(t *testing.T) {
	e := expected()
	manager, trust := setupTrust(
		t,
		"https://tts.example.test",
		"homeai.example.test",
	)
	raw := issue(t, manager, txClaims(trust, e), time.Minute)

	out := VerifyAndBind(context.Background(), raw, trust, e)

	if !out.CryptographicValidationVerified ||
		!out.TrustDomainKeySourceVerified ||
		!out.IssuerAuthenticatedAgainstConfiguredTrustAnchor ||
		!out.RequiredClaimsVerified ||
		!out.FlyThinkProfileBindingVerified ||
		!out.ReadyForCanonicalTrustIntegration {
		t.Fatalf("unexpected verdict: %+v", out)
	}
	if out.TokenSHA256 == "" || out.TrustAnchorSHA256 == "" {
		t.Fatalf("evidence digests missing: %+v", out)
	}
	if out.TrustAnchorSource != trust.Source {
		t.Fatalf("trust-anchor provenance missing: %+v", out)
	}
}

func TestDraft11IssuerOmissionPassesWhenProfileDoesNotRequireIssuer(t *testing.T) {
	e := expected()
	manager, trust := setupTrust(
		t,
		"",
		"homeai.example.test",
	)
	raw := issueWithoutIssuer(t, manager, trust, e, time.Minute)

	out := VerifyAndBind(context.Background(), raw, trust, e)

	if !out.CryptographicValidationVerified ||
		!out.TrustDomainKeySourceVerified ||
		!out.RequiredClaimsVerified ||
		!out.FlyThinkProfileBindingVerified ||
		!out.ReadyForCanonicalTrustIntegration {
		t.Fatalf("draft-11 issuer omission was incorrectly rejected: %+v", out)
	}
	if out.IssuerAuthenticatedAgainstConfiguredTrustAnchor {
		t.Fatalf("issuer authenticity was claimed without a configured issuer: %+v", out)
	}
}

func TestKontxtCryptoSuccessDoesNotBypassConfiguredIssuerBinding(t *testing.T) {
	e := expected()
	manager, trust := setupTrust(
		t,
		"https://tts.example.test",
		"homeai.example.test",
	)
	claims := txClaims(trust, e)
	claims.Issuer = "https://other-issuer.example.test"
	raw := issue(t, manager, claims, time.Minute)

	out := VerifyAndBind(context.Background(), raw, trust, e)

	if !out.CryptographicValidationVerified ||
		!out.TrustDomainKeySourceVerified {
		t.Fatalf("expected Kontxt trust-domain verification to pass: %+v", out)
	}
	if out.IssuerAuthenticatedAgainstConfiguredTrustAnchor ||
		out.ReadyForCanonicalTrustIntegration {
		t.Fatalf("configured issuer mismatch was promoted: %+v", out)
	}
	if out.FailureStage != "issuer_binding" {
		t.Fatalf("wrong failure stage: %+v", out)
	}
}

func TestForgedExpectedIssuerSignedByUntrustedKeyIsBlocked(t *testing.T) {
	e := expected()
	_, trust := setupTrust(
		t,
		"https://tts.example.test",
		"homeai.example.test",
	)

	attacker, err := keys.NewManager(2048, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	raw := issue(t, attacker, txClaims(trust, e), time.Minute)

	out := VerifyAndBind(context.Background(), raw, trust, e)

	if out.CryptographicValidationVerified ||
		out.TrustDomainKeySourceVerified ||
		out.IssuerAuthenticatedAgainstConfiguredTrustAnchor ||
		out.ReadyForCanonicalTrustIntegration {
		t.Fatalf("rogue signer minted configured trust: %+v", out)
	}
	if out.FailureStage != "external_token_verification" {
		t.Fatalf("wrong failure stage: %+v", out)
	}
}

func TestKontxtCryptoSuccessDoesNotBypassFlyThinkTctxBinding(t *testing.T) {
	e := expected()
	manager, trust := setupTrust(
		t,
		"https://tts.example.test",
		"homeai.example.test",
	)
	claims := txClaims(trust, e)
	claims.TransactionContext["flythink"].(map[string]any)["patch_digest"] =
		strings.Repeat("f", 64)
	raw := issue(t, manager, claims, time.Minute)

	out := VerifyAndBind(context.Background(), raw, trust, e)

	if !out.CryptographicValidationVerified ||
		!out.TrustDomainKeySourceVerified ||
		!out.IssuerAuthenticatedAgainstConfiguredTrustAnchor {
		t.Fatalf("external verification unexpectedly failed: %+v", out)
	}
	if out.FlyThinkProfileBindingVerified ||
		out.ReadyForCanonicalTrustIntegration {
		t.Fatalf("tctx mismatch was promoted: %+v", out)
	}
	if out.FailureStage != "flythink_tctx_binding" {
		t.Fatalf("wrong failure stage: %+v", out)
	}
}

func TestMissingTctxRemainsBlockedAfterValidSignature(t *testing.T) {
	e := expected()
	manager, trust := setupTrust(
		t,
		"https://tts.example.test",
		"homeai.example.test",
	)
	claims := txClaims(trust, e)
	claims.TransactionContext = nil
	raw := issue(t, manager, claims, time.Minute)

	out := VerifyAndBind(context.Background(), raw, trust, e)

	if !out.CryptographicValidationVerified ||
		!out.TrustDomainKeySourceVerified ||
		!out.IssuerAuthenticatedAgainstConfiguredTrustAnchor {
		t.Fatalf("external verification unexpectedly failed: %+v", out)
	}
	if out.ReadyForCanonicalTrustIntegration ||
		out.FailureStage != "flythink_tctx_binding" {
		t.Fatalf("missing tctx was promoted: %+v", out)
	}
}

func TestWrongAudienceFailsInKontxtBeforeFlyThinkProfile(t *testing.T) {
	e := expected()
	manager, trust := setupTrust(
		t,
		"https://tts.example.test",
		"homeai.example.test",
	)
	claims := txClaims(trust, e)
	claims.Audience = "other.example.test"
	raw := issue(t, manager, claims, time.Minute)

	out := VerifyAndBind(context.Background(), raw, trust, e)

	if out.CryptographicValidationVerified ||
		out.TrustDomainKeySourceVerified ||
		out.ReadyForCanonicalTrustIntegration {
		t.Fatalf("wrong audience passed external verifier: %+v", out)
	}
	if out.FailureStage != "external_token_verification" {
		t.Fatalf("wrong failure stage: %+v", out)
	}
}

func TestExpiredTokenFailsInKontxtBeforeFlyThinkProfile(t *testing.T) {
	e := expected()
	manager, trust := setupTrust(
		t,
		"https://tts.example.test",
		"homeai.example.test",
	)
	raw := issue(t, manager, txClaims(trust, e), -time.Second)

	out := VerifyAndBind(context.Background(), raw, trust, e)

	if out.CryptographicValidationVerified ||
		out.TrustDomainKeySourceVerified ||
		out.ReadyForCanonicalTrustIntegration {
		t.Fatalf("expired token passed external verifier: %+v", out)
	}
	if out.FailureStage != "external_token_verification" {
		t.Fatalf("wrong failure stage: %+v", out)
	}
}

func TestTrustAnchorMustBeConfiguredBeforeVerification(t *testing.T) {
	e := expected()
	trust := TrustAnchor{
		JWKSURL:  "https://jwks.example.test",
		Audience: "homeai.example.test",
	}

	out := VerifyAndBind(context.Background(), "not-a-token", trust, e)

	if out.FailureStage != "trust_anchor_configuration" ||
		out.CryptographicValidationVerified ||
		out.TrustDomainKeySourceVerified ||
		out.ReadyForCanonicalTrustIntegration {
		t.Fatalf("unproven trust anchor was accepted: %+v", out)
	}
}
