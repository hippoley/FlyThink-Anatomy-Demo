"""Run native inference, durable recording and real Phoenix HTTP readback locally."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from trajectory_store import TrajectoryStore
from phoenix_trajectory import export_phoenix

ROOT = Path(__file__).resolve().parents[1]


def get(url):
    with urllib.request.urlopen(url, timeout=2) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--checkpoint', required=True)
    parser.add_argument('--out', type=Path, default=Path('telemetry/phoenix-smoke-evidence.json'))
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        base = Path(directory)
        env = {**os.environ, 'PHOENIX_WORKING_DIR': str(base/'phoenix'), 'PHOENIX_HOST': '127.0.0.1',
               'PHOENIX_PORT': '16006', 'PHOENIX_GRPC_PORT': '14317', 'PHOENIX_LOG_SQL': 'false',
               'PHOENIX_DISABLE_AGENT_ASSISTANT': 'true', 'PHOENIX_TELEMETRY_ENABLED': 'false',
               'PHOENIX_ALLOW_EXTERNAL_RESOURCES': 'false'}
        log = (base/'phoenix.log').open('w')
        server = subprocess.Popen([str(Path(sys.executable).with_name('phoenix')), 'serve'], env=env, stdout=log, stderr=subprocess.STDOUT)
        store = None
        try:
            last_error=None
            for _ in range(450):
                try: get('http://127.0.0.1:16006/v1/projects'); break
                except (urllib.error.URLError, TimeoutError) as error:
                    last_error=str(error)
                    if server.poll() is not None: raise RuntimeError('Phoenix exited: ' + (base/'phoenix.log').read_text()[-1000:])
                    time.sleep(.2)
            else: raise RuntimeError('Phoenix did not become ready: ' + str(last_error) + '; ' + '\n'.join(line for line in (base/'phoenix.log').read_text().splitlines() if 'ERROR' in line or 'Uvicorn running' in line or 'startup' in line))
            database = base/'trajectory.sqlite3'
            result = subprocess.run([sys.executable, 'scripts/infer_flywire_delta.py', '--checkpoint', args.checkpoint,
                '--telemetry-db', str(database), '把客厅灯打开', '关掉', '调到30%', '暂停刚才那项', '全部撤回'], cwd=ROOT, check=True, text=True, capture_output=True)
            inference = json.loads(result.stdout)
            store = TrajectoryStore(database)
            store.feedback(inference['trace'][0]['event_id'], kind='rating', source='evaluator', score=-1, correction={'fixture': 'telemetry smoke; not a human label'})
            assert len(list(store.export())) == 5
            assert len(list(store.export(training_only=True))) == 0
            exported = export_phoenix(store, 'http://127.0.0.1:16006/v1/traces', 'flythink-smoke')
            assert exported == 5
            assert export_phoenix(store, 'http://127.0.0.1:16006/v1/traces', 'flythink-smoke') == 0
            spans=[]
            for _ in range(100):
                try: spans = get('http://127.0.0.1:16006/v1/projects/flythink-smoke/spans?limit=100')['data']
                except urllib.error.HTTPError as error:
                    if error.code != 404: raise
                if len(spans) == 26: break
                time.sleep(.2)
            if len(spans) != 26:
                Path('telemetry/phoenix-smoke-debug.log').write_text((base/'phoenix.log').read_text())
                print(json.dumps({'projects':get('http://127.0.0.1:16006/v1/projects'),'span_names':[s['name'] for s in spans]}))
            assert len(spans) == 26, len(spans)
            roots = [s for s in spans if s['name']=='flythink.turn']
            assert len(roots)==5
            local_ids = {r['trace_id'] for r in store.db.execute('SELECT trace_id FROM turns')}
            assert local_ids == {s['context']['trace_id'] for s in roots}
            from importlib.metadata import version
            evidence = {'real_phoenix_readback': True, 'phoenix_version': version('arize-phoenix'),
                'model_checkpoint': args.checkpoint, 'native_turns': 5, 'phase_spans': 20,
                'feedback_spans': 1, 'phoenix_total_spans': len(spans), 'retry_new_turns': 0,
                'unreviewed_training_rows': 0, 'trace_ids_match_sqlite': True,
                'execution_environment': 'simulation', 'fixture': 'controlled_smoke_not_user_reward',
                'model_sha256': list(store.export())[0]['provenance']['model_sha256']}
            args.out.parent.mkdir(parents=True, exist_ok=True); args.out.write_text(json.dumps(evidence, indent=2)+'\n')
            print(json.dumps(evidence, indent=2))
        finally:
            if store: store.close()
            server.terminate()
            try: server.wait(timeout=8)
            except subprocess.TimeoutExpired: server.kill(); server.wait()
            log.close()


if __name__ == '__main__': main()
