"""Local, append-only trajectory evidence. No training or automatic rewards."""
import hashlib
import json
import math
import sqlite3
import time
import uuid
from pathlib import Path


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(',', ':'))


class TrajectoryStore:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY, closed INTEGER NOT NULL DEFAULT 0, terminated INTEGER NOT NULL DEFAULT 0, reason TEXT);
        CREATE TABLE IF NOT EXISTS turns(id TEXT PRIMARY KEY, episode TEXT NOT NULL REFERENCES episodes(id), step INTEGER NOT NULL, payload TEXT NOT NULL, trace_id TEXT, span_id TEXT, exported_at INTEGER, UNIQUE(episode,step));
        CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES turns(id), payload TEXT NOT NULL, created_ns INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS feedback_exports(id TEXT PRIMARY KEY REFERENCES feedback(id), exported_at INTEGER NOT NULL);
        ''')

    def close(self):
        self.db.close()

    def record(self, event):
        event = json.loads(encode(event))
        required = ('event_id', 'episode_id', 'step', 'observation', 'state_before', 'raw_action', 'action', 'state_after', 'provenance', 'execution')
        if any(k not in event for k in required):
            raise ValueError('incomplete trajectory')
        if type(event['step']) is not int or event['step'] < 1:
            raise ValueError('step must be a positive integer')
        if not all(isinstance(event[k], str) and event[k] for k in ('event_id', 'episode_id')):
            raise ValueError('event and episode IDs are required')
        if not isinstance(event['provenance'], dict) or not event['provenance'].get('runtime'):
            raise ValueError('runtime provenance is required')
        payload = encode(event)
        with self.db:
            old = self.db.execute('SELECT payload FROM turns WHERE id=?', (event['event_id'],)).fetchone()
            if old:
                if old['payload'] != payload:
                    raise ValueError('event ID already exists with different evidence')
                return False
            self.db.execute('INSERT OR IGNORE INTO episodes(id) VALUES(?)', (event['episode_id'],))
            episode = self.db.execute('SELECT * FROM episodes WHERE id=?', (event['episode_id'],)).fetchone()
            if episode['closed']:
                raise ValueError('episode is closed')
            previous = self.db.execute('SELECT * FROM turns WHERE episode=? ORDER BY step DESC LIMIT 1', (event['episode_id'],)).fetchone()
            if previous:
                if event['step'] != previous['step'] + 1:
                    raise ValueError('missing or reordered turn')
                if encode(event['state_before']) != encode(json.loads(previous['payload'])['state_after']):
                    raise ValueError('state continuity mismatch')
            elif event['step'] != 1:
                raise ValueError('first step must be 1; import the full episode')
            self.db.execute('INSERT INTO turns(id,episode,step,payload) VALUES(?,?,?,?)', (event['event_id'], event['episode_id'], event['step'], payload))
        return True

    def feedback(self, turn_id, *, feedback_id=None, kind, source, score=None, correction=None):
        if kind not in ('incorrect', 'correct', 'rating', 'correction_candidate') or source not in ('human', 'device', 'evaluator'):
            raise ValueError('unsupported feedback kind or source')
        if score is not None and (type(score) not in (int, float) or not math.isfinite(score) or not -1 <= score <= 1):
            raise ValueError('score must be finite and between -1 and 1')
        if kind == 'correction_candidate' and score is not None:
            raise ValueError('candidate corrections cannot assign rewards')
        feedback_id = feedback_id or uuid.uuid4().hex
        payload = encode({'kind': kind, 'source': source, 'score': score, 'correction': correction})
        with self.db:
            existing = self.db.execute('SELECT * FROM feedback WHERE id=?', (feedback_id,)).fetchone()
            if existing:
                if existing['turn_id'] != turn_id or existing['payload'] != payload:
                    raise ValueError('feedback ID conflict')
                return feedback_id
            self.db.execute('INSERT INTO feedback VALUES(?,?,?,?)', (feedback_id, turn_id, payload, time.time_ns()))
        return feedback_id

    def finish(self, episode_id, *, terminated=False, reason='input_exhausted'):
        with self.db:
            episode = self.db.execute('SELECT * FROM episodes WHERE id=?', (episode_id,)).fetchone()
            if not episode:
                raise ValueError('unknown episode')
            if episode['closed'] and (bool(episode['terminated']) != bool(terminated) or episode['reason'] != reason):
                raise ValueError('episode already closed with another outcome')
            self.db.execute('UPDATE episodes SET closed=1,terminated=?,reason=? WHERE id=?', (int(terminated), reason, episode_id))

    def export(self, *, training_only=False):
        rows = self.db.execute('SELECT t.*,e.closed,e.terminated,e.reason FROM turns t JOIN episodes e ON e.id=t.episode ORDER BY t.episode,t.step').fetchall()
        last_steps = {row['episode']: row['step'] for row in rows}
        for row in rows:
            event = json.loads(row['payload'])
            feedback = [dict(json.loads(r['payload']), feedback_id=r['id']) for r in self.db.execute('SELECT * FROM feedback WHERE turn_id=? ORDER BY created_ns,id', (row['id'],))]
            # Only explicit human numeric ratings form the initial reward policy.
            ratings = [f for f in feedback if f['source'] == 'human' and f['score'] is not None]
            reward = ratings[-1]['score'] if ratings else None
            eligible = bool(row['closed']) and reward is not None and event['raw_action'] is not None and event['provenance'].get('runtime') == 'real_flywire_delta' and bool(event['provenance'].get('model_sha256'))
            if training_only and not eligible:
                continue
            last = row['step'] == last_steps[row['episode']]
            yield {**event, 'schema_version': 'flythink.trajectory.v1', 'feedback': feedback,
                   'reward': reward, 'reward_policy': 'explicit-human-score-v1',
                   'reward_feedback_id': ratings[-1]['feedback_id'] if ratings else None,
                   'terminated': last and bool(row['terminated']),
                   'truncated': last and not bool(row['terminated']),
                   'episode_closed': bool(row['closed']), 'episode_end_reason': row['reason'],
                   'training_eligible': eligible, 'ppo_ready': False,
                   'trace_id': row['trace_id'], 'span_id': row['span_id']}

    def review_queue(self, *, status='unreviewed', runtime='all', limit=50):
        """Return bounded, newest-first evidence for the local human review UI."""
        if status not in ('unreviewed', 'reviewed', 'all'):
            raise ValueError('status must be unreviewed, reviewed or all')
        if runtime not in ('all', 'real_flywire_delta', 'browser_rule_runtime'):
            raise ValueError('unsupported runtime filter')
        if type(limit) is not int or not 1 <= limit <= 200:
            raise ValueError('limit must be between 1 and 200')
        rows = list(self.export())
        result = []
        for row in reversed(rows):
            human_ratings = [item for item in row['feedback']
                             if item['source'] == 'human' and item['score'] is not None]
            reviewed = bool(human_ratings)
            if status == 'reviewed' and not reviewed:
                continue
            if status == 'unreviewed' and reviewed:
                continue
            if runtime != 'all' and row['provenance'].get('runtime') != runtime:
                continue
            result.append({
                'event_id': row['event_id'], 'episode_id': row['episode_id'],
                'step': row['step'], 'observation': row['observation'],
                'raw_action': row['raw_action'], 'action': row['action'],
                'state_before': row['state_before'], 'state_after': row['state_after'],
                'execution': row['execution'], 'provenance': row['provenance'],
                'feedback': row['feedback'], 'reward': row['reward'],
                'reviewed': reviewed, 'episode_closed': row['episode_closed'],
                'training_eligible': row['training_eligible'],
                'trace_id': row['trace_id'], 'span_id': row['span_id'],
            })
            if len(result) == limit:
                break
        counts = {'returned': len(result), 'reviewed': 0, 'unreviewed': 0,
                  'training_eligible': 0}
        for row in rows:
            if runtime != 'all' and row['provenance'].get('runtime') != runtime:
                continue
            reviewed = any(item['source'] == 'human' and item['score'] is not None
                           for item in row['feedback'])
            counts['reviewed' if reviewed else 'unreviewed'] += 1
            counts['training_eligible'] += int(row['training_eligible'])
        return {'items': result, 'counts': counts, 'filters': {
            'status': status, 'runtime': runtime, 'limit': limit}}


def browser_event(event):
    """Browser rule predictions are never labeled as real FlyWire inference."""
    return {'event_id': event['event_id'], 'episode_id': event['episode_id'], 'step': event['trajectory_step'],
            'observation': {'text': event['text']}, 'state_before': event['before'], 'state_after': event['after'],
            'raw_action': None, 'action': event['delta'], 'provenance': {'runtime': 'browser_rule_runtime', 'model_sha256': None},
            'execution': {'kind': 'simulation', 'outcome': event['outcome'], 'world_deltas': event['world_deltas']},
            'behavior_logprob': None, 'started_ns': event.get('started_ms', 0) * 1000000,
            'ended_ns': event.get('ended_ms', 0) * 1000000, 'phases': []}
