# AER-1 × FlyThink claim-scope interop fixture

This fixture was prepared after an explicit request from the AER-1 author for a concrete interoperability case.

It targets `draft-zambo-aer1-12` as currently published. The AER side verifies the narrow core claim: exact canonical bytes, output commitment, tool metadata, timestamp and provenance class. The FlyThink side separately appraises whether physical completion is proven against a criterion fixed before actuation.

Run:

```sh
node interop/aer1-physical-completion/verify_fixture.cjs
```

The four cases deliberately vary the two proof systems independently:

1. AER valid + physical completion proven.
2. AER valid + physical completion indeterminate because readback is stale.
3. AER invalid because canonical bytes no longer match the output commitment + physical completion still proven.
4. AER valid + physical evidence invalid because the completion criterion is not authorization-bound.

The invariant under test is:

> Binding two artifacts must not cause either artifact to inherit claims that only the other verifier established.

This is an interoperability fixture, not an extension to AER-1 and not a proposal for new AER-1 core fields.