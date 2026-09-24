"""Collect, replay and export FlyThink telemetry locally."""
import argparse
import base64
import gzip
import json
import sqlite3
import threading
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, unquote, parse_qs
from trajectory_store import TrajectoryStore, browser_event, encode

ROOT = Path(__file__).resolve().parents[1]


def ingest(store, body):
    events = body['events']
    if not isinstance(events, list) or len(events) > 200:
        raise ValueError('expected at most 200 events')
    inserted = 0
    for event in events:
        inserted += store.record(browser_event(event))
        if event.get('feedback') == 'incorrect':
            store.feedback(event['event_id'], feedback_id=event['event_id'] + ':incorrect', kind='incorrect', source='human')
        if event.get('correction_candidate'):
            store.feedback(event['event_id'], feedback_id=event['event_id'] + ':candidate', kind='correction_candidate', source='human', correction=event['correction_candidate'])
    return inserted


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, database, **kwargs):
        self.database = database
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == '/telemetry/health':
            return self.reply(200, {'status': 'ok', 'storage': 'sqlite'})
        if path == '/telemetry/review':
            store = None
            try:
                query = parse_qs(parsed.query)
                status = query.get('status', ['unreviewed'])[0]
                runtime = query.get('runtime', ['all'])[0]
                limit = int(query.get('limit', ['50'])[0])
                store = TrajectoryStore(self.database)
                return self.reply(200, store.review_queue(
                    status=status, runtime=runtime, limit=limit))
            except (ValueError, TypeError, sqlite3.Error) as error:
                return self.reply(400, {'error': str(error)})
            finally:
                if store: store.close()
        # Do not expose trajectory databases, source directories or checkpoints.
        name = path.lstrip('/') or 'index.html'
        if '/' in name or name.startswith('.') or Path(name).suffix not in ('.html', '.js', '.css', '.json', '.svg', '.png', '.ico'):
            return self.reply(404, {'error': 'not found'})
        asset = ROOT / 'data' / (name + '.gz.b64')
        if not (ROOT / name).exists() and asset.is_file():
            raw = ''.join(asset.read_text().split())
            data = gzip.decompress(base64.b64decode(raw + '=' * (-len(raw) % 4)))
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
            return
        return super().do_GET()

    def do_HEAD(self):
        name = unquote(urlparse(self.path).path).lstrip('/') or 'index.html'
        if '/' in name or name.startswith('.') or Path(name).suffix not in ('.html', '.js', '.css', '.json', '.svg', '.png', '.ico'):
            self.send_response(404); self.end_headers(); return
        return super().do_HEAD()

    def reply(self, status, payload):
        data = encode(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        # Same-origin JSON only, default loopback listener, no wildcard CORS.
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        if urlparse('http://' + host).hostname not in ('localhost', '127.0.0.1', '::1') or (origin and origin != 'http://' + host):
            return self.reply(403, {'error': 'same-origin local requests only'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reply(415, {'error': 'JSON required'})
        store = None
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8_000_000:
                raise ValueError('invalid body size')
            body = json.loads(self.rfile.read(size))
            store = TrajectoryStore(self.database)
            if self.path == '/telemetry/turns':
                result = {'inserted': ingest(store, body)}
            elif self.path == '/telemetry/finish':
                store.finish(body['episode_id'], terminated=False, reason='browser_reset')
                result = {'closed': True}
            elif self.path == '/telemetry/feedback':
                feedback_id = store.feedback(
                    body['event_id'], feedback_id=body['feedback_id'],
                    kind='rating', source='human', score=body['score'],
                    correction=body.get('correction'))
                result = {'feedback_id': feedback_id, 'recorded': True}
            else:
                return self.reply(404, {'error': 'not found'})
            self.reply(200, result)
        except (ValueError, KeyError, TypeError, sqlite3.Error) as error:
            self.reply(400, {'error': str(error)})
        finally:
            if store: store.close()


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--db', default='telemetry/trajectories.sqlite3')
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('serve'); p.add_argument('--port', type=int, default=8765); p.add_argument('--phoenix-endpoint'); p.add_argument('--allow-remote', action='store_true')
    p = sub.add_parser('import-browser'); p.add_argument('file', type=Path)
    p = sub.add_parser('finish'); p.add_argument('episode'); p.add_argument('--terminated', action='store_true'); p.add_argument('--reason', required=True)
    p = sub.add_parser('feedback'); p.add_argument('event'); p.add_argument('--score', type=float, required=True); p.add_argument('--correction')
    p = sub.add_parser('export'); p.add_argument('--out', required=True, type=Path); p.add_argument('--training-only', action='store_true')
    p = sub.add_parser('phoenix'); p.add_argument('--endpoint', default='http://127.0.0.1:6006/v1/traces'); p.add_argument('--allow-remote', action='store_true'); p.add_argument('--project', default='flythink')
    args = parser.parse_args()
    if args.command == 'serve':
        stop = threading.Event()
        if args.phoenix_endpoint:
            from phoenix_trajectory import export_phoenix
            def drain():
                while not stop.is_set():
                    worker_store = TrajectoryStore(args.db)
                    try: export_phoenix(worker_store, args.phoenix_endpoint, allow_remote=args.allow_remote)
                    except Exception as error: print('Phoenix export pending: ' + type(error).__name__, file=sys.stderr, flush=True)
                    finally: worker_store.close()
                    stop.wait(2)
            threading.Thread(target=drain, daemon=True).start()
        server = HTTPServer(('127.0.0.1', args.port), partial(Handler, database=args.db))
        print(f'FlyThink: http://127.0.0.1:{args.port}/?telemetry=local', flush=True)
        print(f'Review:   http://127.0.0.1:{args.port}/review.html', flush=True)
        try: server.serve_forever()
        except KeyboardInterrupt: pass
        finally: stop.set(); server.server_close()
        return
    store = TrajectoryStore(args.db)
    try:
        if args.command == 'import-browser':
            print(encode({'inserted': ingest(store, json.loads(args.file.read_text()))}))
        elif args.command == 'finish':
            store.finish(args.episode, terminated=args.terminated, reason=args.reason)
        elif args.command == 'feedback':
            print(store.feedback(args.event, kind='rating', source='human', score=args.score, correction=args.correction))
        elif args.command == 'export':
            rows = list(store.export(training_only=args.training_only))
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(''.join(encode(row) + '\n' for row in rows))
            print(encode({'transitions': len(rows), 'training_only': args.training_only}))
        elif args.command == 'phoenix':
            from phoenix_trajectory import export_phoenix
            print(encode({'exported_turns': export_phoenix(store, args.endpoint, args.project, args.allow_remote)}))
    finally:
        store.close()


if __name__ == '__main__':
    main()
