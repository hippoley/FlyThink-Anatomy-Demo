# Real FlyWire local training

For the next sequential state experiment and matched topology controls, see
[FLYWIRE_STATE_TRAINING.md](FLYWIRE_STATE_TRAINING.md). It records the failed
state-learning acceptance gates as well as the separate persistence fix.

The core experimental path is `scripts/train_flywire.py`. The existing browser's
216-unit random recurrent network is a separate legacy demo and is not evidence
of real connectome training. This trainer is not yet connected to the browser.

## Reproduce on CPU

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-flywire.txt
python scripts/train_flywire.py --download --neurons 512 --epochs 30
python scripts/infer_flywire.py '改成主卧的窗户' --history '打开客厅窗户'
```

Python 3.12 on Linux CPU is the tested environment. Download requires internet;
after download all training runs locally without an LLM or other inference API.

## Actual network and trainable parameters

- Source: FlyWire FAFB v783 `connections_princeton.csv.gz`, served by the
  official FlyWire data bucket. Root IDs are retained as strings, avoiding
  JavaScript integer precision loss.
- Select the 512 neurons with the highest total incoming plus outgoing synapse
  counts; keep every observed directed connection between those neurons.
  Selection is independent of labels. This is a biased induced subgraph, not
  a representative whole brain or an anatomically selected language circuit.
- Aggregate neuropil rows for each directed neuron pair. The metadata retains
  total synapse counts and signed counts. GABA/GLUT negative signs and positive
  signs for other types are explicit modeling assumptions, not measured
  physiological weights. Normalize incoming absolute weights to 0.8.
- The recurrent weight is `base_weight * 2 * sigmoid(edge_gain)`. Backpropagation
  updates one internal gain per observed connection, as well as the text input
  adapter and output head. No absent recurrent connection can become trainable.
- Dynamics: four leaky tanh rate steps, not the published Shiu LIF spiking model.
  The transferred task is synthetic Chinese dialogue-family classification.
  No claim is made that a biological fruit fly understands language.

## Inspect the evidence

`artifacts/flywire/` contains:

- `connectome.json`: source URL and SHA-256, selection rule, real root IDs,
  observed edges and synapse counts.
- `checkpoint.pt`: trained network tensors, connection indices, labels and source
  hash. This is a trusted local PyTorch artifact; load with `weights_only=True`.
- `metrics.json`: epoch losses, changed internal edge count, held-out accuracy,
  recurrent-edge disconnection ablation and checkpoint SHA-256.
- `split-manifest.json`: hashes of exact train/test inputs.

The evaluation deduplicates exact inputs and separates them by deterministic
hash. Both splits share generator templates: these metrics do **not** establish
unseen-template generalization, multi-slot correctness, generative OOD ability,
or long-horizon dialogue state persistence. The ablation disables recurrence at
inference; it is not a matched retrained random-wiring baseline.

`--neurons 0` imports all neurons present in the connection table, including all
observed edges. That option needs substantially more RAM and compute and has not
been validated by this subgraph run. It does not include zero-degree neurons.

## Remaining core acceptance gates

Current run: 512 neurons / 9,692 edges, 30 CPU epochs; all 9,692 internal gains
changed. Shared-template held-out accuracy is 115/117 (98.29%), but disconnecting
recurrence leaves accuracy unchanged. An independently typed revision probe,
`打开客厅窗户` → `改成主卧的窗户`, is incorrectly classified as `negation`.
This is a known acceptance failure, demonstrating why the generated split score
must not be presented as product readiness or a connectome advantage.

1. Independently authored multi-turn supervision for node additions, revisions,
   scoped retractions, reference resolution and retained intents; hold out whole
   templates/scenarios, not just exact strings.
2. Train and evaluate structured multi-intent/multi-slot outputs on the recurrent
   backbone; family classification alone is not the target product.
3. Matched frozen-connectome, random-rewired and no-recurrence training controls.
4. Wire restored checkpoint predictions into validated state-tree deltas; the
   current CLI verifies restore parity but returns family scores only. OOD
   proposals must pass capability validation.
5. Scale beyond the induced subgraph and report resource use and graph coverage.

Official references:
- https://codex.flywire.ai/faq
- https://github.com/philshiu/Drosophila_brain_model

Consult the source data terms before redistribution or commercial use. Raw
connectivity and checkpoints are excluded from git; small evidence files are
versioned. No random-network fallback is permitted in this training path.
