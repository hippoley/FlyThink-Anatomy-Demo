# Hidden Gold benchmark protocol

Benchmark V3's generated splits are useful for controlled regression, but they
do not by themselves prove independence from FlyThink's generator family.

This protocol creates an admission path for future **human**, **independent
generator**, or **external dataset** cases without exposing gold during model
development.

## Three separate artifacts

1. `benchmark-hidden-input-pack.v1`
   - visible before inference;
   - contains case ID, text, initial runtime and context seed;
   - contains source/provenance metadata, but **no gold**.
2. `benchmark-hidden-prediction-pack.v1`
   - produced against the visible input pack;
   - must bind the exact input-pack byte SHA-256;
   - must predict every case exactly once.
3. `benchmark-hidden-gold-pack.v1`
   - withheld until scoring;
   - binds the same input-pack SHA-256;
   - contains gold decision + canonical patch sequence for every case.

The scorer refuses pack-ID mismatch, input-SHA mismatch, duplicate IDs, missing
cases and extra cases.

## Claim boundary

The protocol can prove:

- exact input/gold/prediction artifact binding;
- that prediction coverage cannot alter the scoring denominator;
- that scoring occurred against a separately supplied gold artifact.

The protocol **cannot** prove that a claimed human or independent generator is
actually independent. That is an external provenance/reviewer question.

Therefore `benchmark-hidden-score-receipt.v1` always keeps:

- `source_independence_externally_verified = false`
- `external_generalization_claim_eligible = false`

until a separately governed provenance-admission mechanism exists.

The repository includes a tiny synthetic `fixture` only to test the protocol.
A fixture score, even 100%, is never evidence of real-world generalization.

## Intended next maturity transition

A real Hidden Gold pack should come from a source not used to generate or tune
Benchmark V3—for example independent human annotation, an independently
maintained generator, or a compatible external dataset with a reviewable
license/revision. Development sees the input pack; the gold pack stays outside
the optimization loop until the prediction artifact is frozen.
