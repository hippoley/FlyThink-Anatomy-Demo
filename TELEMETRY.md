# FlyThink trajectories and Phoenix

FlyThink now records real local FlyWire inference into an append-only SQLite trajectory store, and exports OpenInference spans over OpenTelemetry to self-hosted Phoenix. The browser runtime can use the same store, but is explicitly labeled `browser_rule_runtime`: its traces are not FlyWire checkpoint predictions.

## Run locally

From the repository root, create a Python 3.12 environment and install:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-phoenix-server.txt
```

On Windows PowerShell, activate with `.venv\Scripts\Activate.ps1`. Set the environment variables using `$env:NAME='value'` rather than shell assignment syntax.

Start Phoenix in one terminal:

```bash
PHOENIX_HOST=127.0.0.1 PHOENIX_WORKING_DIR=./telemetry/phoenix PHOENIX_TELEMETRY_ENABLED=false PHOENIX_DISABLE_AGENT_ASSISTANT=true PHOENIX_ALLOW_EXTERNAL_RESOURCES=false phoenix serve
```

Start FlyThink in another terminal using the same environment:

```bash
python scripts/telemetry_cli.py serve --phoenix-endpoint http://127.0.0.1:6006/v1/traces
```

- Conversation page: <http://127.0.0.1:8765/?telemetry=local>
- Phoenix: <http://127.0.0.1:6006>, project `flythink`
- Durable database: `telemetry/trajectories.sqlite3`

The collector retries pending exports every two seconds. Phoenix startup can take time; pending SQLite records remain available. The public GitHub Pages demo does not send home conversations to any collector. Its collapsed research tools offer **导出交互轨迹**, which downloads the retained browser session as JSON.

The collector serves the HTML and compressed JSON assets available in the checkout. Some anatomy assets are generated only by the static publishing workflow; the local collector does not regenerate those assets or claim full visual parity with the public demo.

## Capture real FlyWire inference

Install the training requirements and restore a checkpoint from the v18 training bundle, then run:

```bash
python -m pip install -r requirements-flywire.txt
python scripts/infer_flywire_delta.py --checkpoint artifacts/flywire-delta-v18/real.pt '把客厅灯打开' '关掉' '调到30%'
python scripts/telemetry_cli.py phoenix
```

Inference records telemetry by default; `--no-telemetry` disables it and `--telemetry-db PATH` selects another database. Each invocation creates an episode. Exhausting command-line input truncates the episode; it does not assert that a household goal succeeded. The printed output includes episode and event IDs. Actual model and graph hashes, raw neural actions, logits, resolved actions, commit decisions, state changes and timings are recorded.

Each turn appears as `flythink.turn`, with `prediction`, `reference_resolution`, `commit_gate` and `state_commit` child spans. Browser turns have only the root span because no native neural stage timings exist. `session.id` groups multi-turn trajectories. Feedback is exported later as a linked `flythink.feedback` child span. These are feedback spans, not Phoenix's separate native annotation objects; ratings made solely inside Phoenix are not yet imported back into SQLite.

## Feedback and future reinforcement learning

Human feedback must name an event explicitly:

```bash
python scripts/telemetry_cli.py feedback EVENT_ID --score -1 --correction '应该关闭客厅灯'
python scripts/telemetry_cli.py export --out telemetry/all-trajectories.jsonl
python scripts/telemetry_cli.py export --training-only --out telemetry/reviewed-transitions.jsonl
```

`--score` accepts -1 through 1. A subsequent rating is appended with its own identity; prior evidence is not overwritten. For browser episodes, reset closes the episode as truncated, or explicitly close an imported episode:

```bash
python scripts/telemetry_cli.py import-browser flythink-trajectory-YYYY-MM-DD.json
python scripts/telemetry_cli.py finish EPISODE_ID --reason reviewed_episode_end
```

Use `--terminated` only when explicitly marking a genuine terminal condition. Missing feedback stays `reward: null`. Device/evaluator feedback stays separately labeled; the initial `explicit-human-score-v1` reward policy uses only explicit human numeric scores. Clicking **这个结果不对** records a human error flag, not an invented scalar reward. A following sentence remains a correction candidate, not a verified training label.

Exported transitions include:

| Field | Meaning |
| --- | --- |
| `episode_id`, `step`, `event_id` | Multi-turn ordering and stable event linkage |
| `observation`, `state_before`, `state_after` | Context and observed simulation transition |
| `raw_action`, `action`, `resolved_delta` | Network prediction and subsequent processing |
| `provenance`, `policy_logits`, `decoding` | Runtime/model lineage and neural output evidence |
| `execution` | Simulation versus real device evidence; current executor is simulated |
| `feedback`, `reward`, `reward_feedback_id` | Auditable feedback and explicit credit source |
| `terminated`, `truncated`, `episode_closed` | Environment end versus recording boundary |
| `trace_id`, `span_id` | Phoenix linkage after acknowledged export |

`--training-only` selects scored transitions from closed, model-identified real FlyWire episodes. Browser rule traces remain available for analysis and annotation but are not silently treated as neural behavior data. The exporter provides transition records, not complete PPO rollouts. The current decoder is greedy; `behavior_logprob` remains null and `ppo_ready` is false. Stochastic action sampling, a versioned environment/reward function and RL optimization are still required. No weights are automatically updated by telemetry or Phoenix.

## Reliability and limits

SQLite rejects conflicting retries, missing/reordered steps, state discontinuities and writes into closed episodes. Successful retries are idempotent. Phoenix outages leave an export backlog. The exporter uses a private always-on sampler; host sampling settings cannot silently discard trajectory evidence. OTLP acknowledgements are recorded only after the expected span count is present.

SQLite is authoritative. OTLP delivery is at-least-once across a crash between collector acknowledgement and marking a row exported; such a crash can duplicate Phoenix spans. Use the stable event ID in metadata to identify duplicates. Normal acknowledged retries are skipped. No cross-process exporter lock is implemented: run one collector/export worker per database.

Browser storage retains the latest 200 events; local collection while interacting stores accepted events beyond that browser window. Offline history with a missing prefix is rejected for import rather than presented as a complete episode. Sessions created before this schema lack trajectory IDs; start a new browser session to collect them. Old events remain available in the existing error export. SQLite and Phoenix data are excluded from Git. No automatic retention deletion is configured; manage these local databases explicitly.

## Verification

The controlled smoke test executes five real v18 inference turns, sends 20 child spans plus five turn spans and one evaluator feedback span to Phoenix 20.16.0, reads all **26 spans** back through Phoenix's REST API, and matches trace IDs to SQLite. Re-export adds zero turns. Unreviewed transitions yield zero training rows. This verifies telemetry transport and lineage, not model accuracy or real-device task success.

```bash
python -m unittest discover -s tests -p 'test_trajectory_telemetry.py'
python -m unittest discover -s tests -p 'test_telemetry_http.py'
python -m unittest discover -s tests -p 'test_phoenix_export.py'
node --test tests/*.test.cjs
python scripts/smoke_phoenix_telemetry.py --checkpoint artifacts/flywire-delta-v18/real.pt
```

Evidence: `artifacts/telemetry/phoenix-smoke-evidence.json`.

Integration references: [Phoenix OTEL](https://arize.com/docs/phoenix/tracing/how-to-tracing/setup-tracing/setup-using-phoenix-otel) and [Phoenix self-hosting](https://arize.com/docs/phoenix/self-hosting/deployment-options/docker).
