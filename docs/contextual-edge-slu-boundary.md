# Contextual Edge SLU boundary

FlyThink is not the canonical owner of conversational semantics or task state.

Canonical contract and semantic ownership live in:

- repository: `hippoley/NLUSLOT`
- contract: `contracts/contextual-state-v1.schema.json`
- version: `contextual-state.v1`

FlyThink owns its fly-inspired reasoning experiments, physical execution evidence,
WindowPilot integration and execution-specific safety mechanisms.

## Integration rule

Code that represents the SLU/runtime integration boundary must go through:

`scripts/contextual_edge_slu_adapter.cjs`

Do not import FlyThink private runtime structures as if they were stable Contextual
Edge SLU APIs.

The adapter deliberately exposes logical targets as:

`{ area, entity, instance }`

It does not expose physical device identifiers as semantic identity.

## Migration status

The older FlyThink runtime modules remain temporarily because current checkpoint,
physical-lab and evidence workflows depend on them. They are compatibility
implementations, not the canonical semantic contract.

Migration is complete only when parity tests prove that replacing those internals
does not alter:

- wrong-room = 0
- wrong-device = 0
- untouched-state mutation = 0
- ambiguity -> clarify/defer, never guessed execution
- quarantine and physical commit truth
