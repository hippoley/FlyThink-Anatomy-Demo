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
- static public build publication to `gh-pages`

## Status

This repository is the **public playable surface**.

The complete training/runtime/benchmark implementation remains separate from this public demo so the research UI can stay lightweight, reproducible and easy to explore.

---

**FlyThink is a research instrument, not a claim that a fly connectome has already become a language model.**
