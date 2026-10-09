# Kernel conformance rail v1

The conformance rail is architecture-neutral. A third party can evaluate any
bounded state-transition kernel without importing FlyThink model code.

Provide two frozen JSON files: calibration rows and sealed rows. Each row uses:

```json
{
  "id": "case-001",
  "confidence": 0.997,
  "exact": true,
  "wrong_target": false,
  "untouched_state_corruption": false,
  "ood_false_commit": false
}
```

Only `id`, `confidence` and `exact` are mandatory. Safety fields are
optional and reported when present.

Run:

```bash
python scripts/kernel_conformance.py \
  --calibration calibration.json \
  --sealed sealed.json \
  --target-precision 0.99 \
  --out report.json
```

The threshold is selected from calibration rows only and then frozen. Sealed
labels never select their own threshold. Equal-confidence ties are indivisible,
matching what a deployable scalar confidence threshold can actually do.

This contract creates a stable dependency surface for external kernels while
letting the winning architecture change over time.
