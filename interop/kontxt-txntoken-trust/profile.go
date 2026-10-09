package flythinktxntoken

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/aramase/kontxt/pkg/token"
	"github.com/aramase/kontxt/sdk/verify"
)

const (
	SchemaVersion      = "flythink.kontxt-txntoken-trust.v2"
	PinnedKontxtCommit = "d23ebb50121a650af57c9e34e8227d54db324f9d"
	ExternalVerifier   = "github.com/aramase/kontxt/sdk/verify"
)

// TrustAnchor is execution-boundary configuration. It must come from trusted
// deployment/runtime configuration, never from the proposal or token being
// authorized. The adapter binds issuer identity to one configured JWKS source
// and audience before it asks Kontxt to verify the token.
type TrustAnchor struct {
	Issuer   string `json:"issuer"`
	JWKSURL  string `json:"jwks_url"`
	Audience string `json:"audience"`
	Source   string `json:"source"`
}

type ExpectedBinding struct {
	Subject                  string
	Scope                    string
	RequestingWorkload       string
	PatchDigest              string
	RuntimeRegistryDigest    string
	WorldSnapshotRevision    string
	WorldSnapshotSHA256      string
	CompletionCriteriaSHA256 string
	ExecutionTargetDigest    string
}

type Verdict struct {
	SchemaVersion                                  string `json:"schema_version"`
	ExternalVerifier                               string `json:"external_verifier"`
	ExternalVerifierCommit                         string `json:"external_verifier_commit"`
	TokenSHA256                                    string `json:"token_sha256"`
	TrustAnchorSHA256                              string `json:"trust_anchor_sha256,omitempty"`
	TrustAnchorSource                              string `json:"trust_anchor_source,omitempty"`
	CryptographicValidationVerified                bool   `json:"cryptographic_validation_verified"`
	IssuerAuthenticatedAgainstConfiguredTrustAnchor bool   `json:"issuer_authenticated_against_configured_trust_anchor"`
	RequiredClaimsVerified                         bool   `json:"required_claims_verified"`
	FlyThinkProfileBindingVerified                 bool   `json:"flythink_profile_binding_verified"`
	ReadyForCanonicalTrustIntegration              bool   `json:"ready_for_canonical_trust_integration"`
	FailureStage                                   string `json:"failure_stage,omitempty"`
	FailureReason                                  string `json:"failure_reason,omitempty"`
}

func VerifyAndBind(
	ctx context.Context,
	tokenString string,
	trust TrustAnchor,
	expected ExpectedBinding,
) Verdict {
	sum := sha256.Sum256([]byte(tokenString))
	out := Verdict{
		SchemaVersion:          SchemaVersion,
		ExternalVerifier:       ExternalVerifier,
		ExternalVerifierCommit: PinnedKontxtCommit,
		TokenSHA256:            hex.EncodeToString(sum[:]),
	}

	if err := validateTrustAnchor(trust); err != nil {
		out.FailureStage = "trust_anchor_configuration"
		out.FailureReason = err.Error()
		return out
	}
	out.TrustAnchorSHA256 = trustAnchorDigest(trust)
	out.TrustAnchorSource = trust.Source

	// Construct the external verifier inside the adapter from the configured
	// trust anchor. Callers cannot hand us a verifier pointed at a different
	// JWKS endpoint while still claiming the declared issuer binding.
	verifier := verify.New(trust.JWKSURL, trust.Audience)
	claims, err := verifier.Verify(ctx, tokenString)
	if err != nil {
		out.FailureStage = "external_token_verification"
		out.FailureReason = err.Error()
		return out
	}
	out.CryptographicValidationVerified = true

	if claims.Issuer != trust.Issuer {
		out.FailureStage = "issuer_binding"
		out.FailureReason = fmt.Sprintf(
			"issuer mismatch: got=%q configured=%q",
			claims.Issuer,
			trust.Issuer,
		)
		return out
	}
	out.IssuerAuthenticatedAgainstConfiguredTrustAnchor = true

	if err := validateRequiredClaims(claims, trust, expected); err != nil {
		out.FailureStage = "required_claims"
		out.FailureReason = err.Error()
		return out
	}
	out.RequiredClaimsVerified = true

	if err := validateFlyThinkContext(claims.TransactionContext, expected); err != nil {
		out.FailureStage = "flythink_tctx_binding"
		out.FailureReason = err.Error()
		return out
	}
	out.FlyThinkProfileBindingVerified = true
	out.ReadyForCanonicalTrustIntegration = true
	return out
}

func validateTrustAnchor(trust TrustAnchor) error {
	if trust.Issuer == "" {
		return fmt.Errorf("configured issuer missing")
	}
	if trust.JWKSURL == "" {
		return fmt.Errorf("configured JWKS URL missing")
	}
	if trust.Audience == "" {
		return fmt.Errorf("configured audience missing")
	}
	if trust.Source == "" {
		return fmt.Errorf("trust-anchor provenance source missing")
	}
	return nil
}

func trustAnchorDigest(trust TrustAnchor) string {
	payload, _ := json.Marshal(trust)
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func validateRequiredClaims(
	claims *token.Claims,
	trust TrustAnchor,
	expected ExpectedBinding,
) error {
	if claims == nil {
		return fmt.Errorf("claims missing")
	}
	if claims.IssuedAt <= 0 {
		return fmt.Errorf("iat missing")
	}
	if claims.ExpiresAt <= 0 || claims.ExpiresAt <= claims.IssuedAt {
		return fmt.Errorf("exp missing or not after iat")
	}
	if claims.TransactionID == "" {
		return fmt.Errorf("txn missing")
	}
	if claims.Subject == "" {
		return fmt.Errorf("sub missing")
	}
	if expected.Subject != "" && claims.Subject != expected.Subject {
		return fmt.Errorf("sub mismatch")
	}
	if claims.Audience == "" || claims.Audience != trust.Audience {
		return fmt.Errorf("aud missing or mismatch")
	}
	if claims.Scope == "" || claims.Scope != expected.Scope {
		return fmt.Errorf("scope missing or mismatch")
	}
	if claims.RequestingWorkload == "" ||
		claims.RequestingWorkload != expected.RequestingWorkload {
		return fmt.Errorf("req_wl missing or mismatch")
	}
	return nil
}

func validateFlyThinkContext(tctx map[string]any, expected ExpectedBinding) error {
	if tctx == nil {
		return fmt.Errorf("tctx missing")
	}
	raw, ok := tctx["flythink"]
	if !ok {
		return fmt.Errorf("tctx.flythink missing")
	}
	flythink, ok := raw.(map[string]any)
	if !ok {
		return fmt.Errorf("tctx.flythink must be an object")
	}

	required := map[string]string{
		"patch_digest":               expected.PatchDigest,
		"runtime_registry_digest":    expected.RuntimeRegistryDigest,
		"world_snapshot_revision":    expected.WorldSnapshotRevision,
		"world_snapshot_sha256":      expected.WorldSnapshotSHA256,
		"completion_criteria_sha256": expected.CompletionCriteriaSHA256,
		"execution_target_digest":    expected.ExecutionTargetDigest,
	}
	for key, want := range required {
		if want == "" {
			return fmt.Errorf("expected %s missing", key)
		}
		got, ok := flythink[key].(string)
		if !ok || got == "" {
			return fmt.Errorf("tctx.flythink.%s missing", key)
		}
		if got != want {
			return fmt.Errorf("tctx.flythink.%s mismatch", key)
		}
	}
	return nil
}
