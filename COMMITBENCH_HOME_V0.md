# CommitBench / Home-v0

State-integrity slice derived from the frozen whole-home V2 benchmark.

- 120 trajectories
- 2,502 turns
- 12 persistent devices per home
- frozen source SHA-256: `90b6ea55bc5e28d9545f539aa360cb6075d6dd23802834d8b003883948363482`

The V2 source contains only executable turns, so this slice is valid for exact-state, write-set, drift, and clean-commit evaluation, but is not sufficient by itself to claim Premature Commit or Missed Commit results.

The branch also keeps the existing curated ambiguity failures as a separate commit-boundary challenge seed.

## Four experiment arms

1. Direct Tool Call
2. Full State Regeneration
3. Delta
4. Delta + Commit Gate

The first falsifiable paper hypothesis is that task-level success can remain high while persistent world-state correctness is substantially lower.

Important reality check: the latest long-trajectory probe improved from 61.21% to 65.95% full-patch and from 10.34% to 15.95% whole-home exactness after slot/capability fixes, while unsafe execute, wrong-device, and untouched-state violations remained 0. Therefore collateral mutation is not yet established as the dominant failure mode. The next evaluation must separate wrong slot/value, lost carried-forward state, collateral mutation, and premature commit.
