# FlyThink

**A playable research playground for multi-turn home intelligence and fly-inspired neural state.**

> Talk to a home. Mutate the utterance. Interrupt it. Revise it. Make it ambiguous. Then watch the semantic decision, recurrent neural state, task graph and anatomy view update together.

## Play it

Interactive public build:

https://raw.githack.com/hippoley/FlyThink-Anatomy-Demo/gh-pages/index.html

## Why this exists

Most NLU demos show a single clean command and a final intent label.

FlyThink is designed around the messy part:

- multi-intent utterances
- multi-slot commands
- corrections and revisions
- pronouns and inherited references
- interruptions and resume
- scenario-implied actions
- ambiguity and clarification
- OOD escalation
- persistent task context

The public playground lets you edit and mutate an utterance, then inspect how the runtime changes its interpretation.

## Dialogue Essence · Corpus Mutation Lab

Start from a train-only example or your own sentence, then mutate it:

- reorder wording
- swap slot expressions
- inject an interruption
- inject a revision
- replace explicit entities with ambiguous references
- add a second intent
- convert a direct command into a scenario
- stress-test OOD handling
- split one messy paragraph into multiple turns

The decision layer exposes four bounded heads:

**Entity · Operation · Ambiguity · OOD / Escalation**

This is intentionally closer to a structured decision model than a chat model.

## Multi-turn Corpus Composer

The playground now includes a turn-level composer for messy dialogue sequences. Each turn can be marked as a normal command, interruption, correction, resume, cross-room continuation, or coreference turn. Cards can be reordered by drag-and-drop.

Running a composed scenario resets the session and records, for every turn:

- expected GraphDelta operation
- actual GraphDelta operation and match status
- runtime route and Thing Model action
- dialogue focus
- active task and paused-task stack
- semantic neural readout

This makes interruption/resume, revision, inherited references and cross-room behavior inspectable as a sequence rather than only as a final answer.

## Persistent dialogue state and grounding-first execution

The browser runtime now maintains a persistent instance-scoped state tree instead of treating every utterance as a fresh command. Its default update semantics are:

- same room + device instance + property → patch the existing node;
- new room/device/property → append a new branch;
- omitted slots remain unchanged;
- explicit cancellation or negation is required to remove state;
- room/device session values are keyed by device instance plus the real model/module/property schema path.

Structured `entity / property / operation / value` resolution is authoritative once resolved. The developmental semantic readout remains evidence for inspection and fallback; it can no longer overwrite a resolved structured action merely because a train exemplar is lexically similar.

Scenario expressions can emit a small goal plan (for example movie comfort → brightness + color temperature) before every action is independently validated against the uploaded real Thing Model registry.

The Regression Lab includes state/value patch families and checks for `state_tree_loss`, `duplicate_state_node`, `property_slot`, `value_slot`, `instance_grounding`, and scenario-plan failures.

## Goal/state curriculum

Scenario awareness now has a separate train-only curriculum in `data/goal-state-curriculum.json`: 40 phrases across rain protection, movie comfort, ventilation, sleep transition, and leave-home goals. The build creates dedicated `goal:*` semantic templates for the 216-unit developmental substrate.

The goal curriculum is kept separate from generated public stress episodes. Goal recognition can therefore be inspected as a train-only semantic readout while the Regression Lab uses different wording and multi-turn composition for stress evaluation. This remains a developmental exemplar-driven runtime, not a claim of a fully trained production model.

## Grounding decision trace and goal capability retrieval

Each executable node now exposes a compact provenance trace for room, device instance, property, operation, value, state-tree mutation, and final real-schema binding. The trace distinguishes explicit, inherited/coreference, corrected, and scenario-derived values so a wrong action can be localized to the grounding stage that produced it.

Goal/scenario expressions now retrieve a candidate capability set before execution. Candidate actions are resolved through the immutable runtime binding registry and expose the actual `model_code → module → property` path when available. The public goal plans are explicitly labeled contract-derived; they are not represented as hidden benchmark truth.

The generated stress suite also contains hybrid 4–10 turn episodes that mix value patches, cross-room references, goal planning, interruption/resume, and cancellation in one sequence. New diagnostics include `goal_resolution`, `goal_plan_contract`, `capability_retrieval`, and `capability_schema_missing`.

## Multi-turn Regression Lab

The public playground also includes a deterministic batch regression lab. It can generate 12–48 synthetic-but-structured dialogue sequences, each 4–10 turns long, from bounded home-control primitives. These sequences exercise interruption/resume, revision, coreference, cross-room inheritance and cancellation.

Each turn is checked independently across multiple layers:

- GraphDelta operation
- entity and room resolution
- interruption / paused-task stack
- resume target
- revision / cancellation semantics
- semantic neural readout
- runtime route
- expected action
- real Thing Model grounding

Failures are grouped by cause (for example `coreference`, `semantic_readout`, `resume_stack`, `action_grounding`). Any generated or failing sequence can be loaded directly into the Multi-turn Corpus Composer for reproduction and inspection.

The generated batch is an evaluation surface, not additional training data.

## Neural path

The public build visualizes this pipeline:

```
utterance
   ↓
train-only semantic exemplars
   ↓
semantic drive
   ↓
216-unit developmental recurrent substrate
   ↓
3× recurrent settling
   ↓
GraphDelta + dialogue/task context
   ↓
route / action / Thing Model
```

The recurrent view shows directional pulse animation after each turn.

## Anatomy view

The right-hand visualization uses real Codex / FlyWire FAFB v783 coordinates.

Three truth domains are kept separate:

- **gray-green** — real Codex FAFB v783 anatomical coordinates
- **blue** — visualization projection of the current developmental neural state
- **gold** — measured FlyWire replay evidence

The blue projection now uses a deterministic **projection pool that explicitly excludes every measured replay root**. The UI exposes a clickable **Neural Bridge** showing the strongest developmental unit, population, activation and mapped anatomy root for the current turn.

Blue does **not** mean those FlyWire neurons literally executed the Chinese command.

## What is doing the reasoning?

The public demo currently combines:

1. a contract-compatible browser semantic resolver,
2. train-only semantic exemplars,
3. bounded structured decision heads,
4. a 216-unit developmental recurrent state,
5. GraphDelta / task-context constraints.

It is **not ChatGPT**, and it does **not** claim that measured FlyWire neurons directly understand language.

Open-ended or low-confidence cases are designed to escalate rather than force a bounded local decision.

## Data provenance

Real anatomical coordinates are built from:

`FlyWire / Codex FAFB v783 coordinates.csv.gz`

The build downloads the coordinate table and derives a deterministic display sample.

Measured activity shown in gold is a pinned replay fixture kept separate from developmental product-state visualization.

## Reproducibility

Every push to `main` runs:

- browser JavaScript syntax smoke
- developmental neural artifact export
- real anatomy data build
- root-ID mapping checks
- projection-pool / measured-replay disjointness checks
- static public build publication to `gh-pages`

## Status

This repository is the **public playable surface**.

The complete training/runtime/benchmark implementation remains separate from this public demo so the research UI can stay lightweight, reproducible and easy to explore.

---

**FlyThink is a research instrument, not a claim that a fly connectome has already become a language model.**


## Capability inspection and execution gate

The Thing Model Inspector now searches all 794 indexed capabilities by model, module, title and description. Select a result to inspect its permissions, type, enum and range, then check a JSON value without executing a command. Original JSON is shown only when available; other entries explicitly show the capability projection.

The shared execution gate rejects missing write values, non-finite numbers, fractional integers, integer overflow, type/enum/range violations and event commands. The compact index does not include service input or nested-value schemas, so these operations are blocked pending full schema validation. Read permission checks do not require a write value.

Run `python scripts/build_capability_index.py` followed by `node --test tests/capability-gate.test.cjs`. Tests cover all 794 capability rows and verify rejected writes cannot mutate session device values.

## Guided conversation entry

The default screen has one scenario selector, one conversation draft and one Send action. Device changes and a suggested next utterance appear beside the conversation. Only schema-validated session changes populate the result cards; blocked or escalated turns are explained without claiming live device execution.

Turn evidence appears after the first result. Corpus mutation, multi-turn composition, batch regression, capability inspection and neural/anatomy views are grouped under a closed Research Tools disclosure. Changing the scenario or choosing Restart clears the session and restores the corresponding first utterance.

Every result now includes a compact, automatically animated neural layer: the left side shows the 216-unit developmental recurrent state and the right side projects the strongest units onto real FlyWire coordinate roots. The coordinate projection is explicitly separated from measured neural activity.

The public registry embeds all 46 original JSON schemas from `全产品物模型定义(8).rar` (archive SHA-256 `3a5e67efd5847d70761076506500d001cbed36b1d19dca60ed286eb72ae5d60c`). Run `python scripts/build_full_thing_registry.py` to verify 46/46 schema completeness; pass `--source-dir` only when rebuilding from the extracted archive.

## Compositional room and object goals

The bounded planner can now compile one utterance into independent room-scoped frames. It supports different goals in different rooms, whole-home expansion, multiple objects per room, and constraint substitution. For example, “主卧很闷，外面下雨了，我又不想开窗” preserves the no-open-window constraint and retrieves the main-bedroom fresh-air capabilities instead of forcing a window action.

Conflicting values for the same room, entity and property do not execute. They produce one targeted clarification. Every inferred node remains subject to the room inventory, global 46-model capability retrieval, permission/type/enum/range validation and the existing score-and-margin commit gate.
