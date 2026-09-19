# FlyThink × Real FlyWire Anatomy Demo

Public, truth-separated interactive demo for **FlyThink × FlyWire**.

## What this shows

- Multi-turn home-language decisions on the left.
- Real FlyWire / Codex FAFB v783 anatomical coordinates on the right.
- Verified measured FlyWire root IDs highlighted in anatomical space.
- Click / rotate / zoom inspection.
- Explicit separation between:
  - product-runtime semantics,
  - verified measured FlyWire replay evidence,
  - anatomical geometry.

## What this does **not** claim

This public demo does **not** claim that FlyWire directly understands Chinese or that the measured replay is a live language execution.

The public Pages build downloads the Codex FAFB v783 coordinate table at build time and creates a deterministic rendering sample.

## Public demo

Once GitHub Pages deployment is complete:

https://hippoley.github.io/FlyThink-Anatomy-Demo/

## Data provenance

- Codex / FlyWire FAFB v783 anatomical coordinates:
  `https://storage.googleapis.com/flywire-data/codex/data/fafb/783/coordinates.csv.gz`
- Measured root IDs in `data/measured-roots.json` are a verified replay fixture used for visualization.
