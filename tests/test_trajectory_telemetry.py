import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from trajectory_store import TrajectoryStore


def event(step=1):
    return {'event_id': f'e{step}', 'episode_id': 'session', 'step': step,
            'observation': {'text': '关掉'}, 'state_before': {'value': step - 1},
            'raw_action': {'operation': 'revise'}, 'action': {'operation': 'revise'},
            'state_after': {'value': step}, 'provenance': {'runtime': 'real_flywire_delta', 'model_sha256': 'test'},
            'execution': {'kind': 'simulation', 'accepted': True}, 'behavior_logprob': None}


class TrajectoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'events.sqlite3'
        self.store = TrajectoryStore(self.path)

    def tearDown(self):
        self.store.close(); self.tmp.cleanup()

    def test_idempotent_retry_and_immutable_evidence(self):
        self.assertTrue(self.store.record(event()))
        self.assertFalse(self.store.record(event()))
        changed = event(); changed['action'] = {'operation': 'clear'}
        with self.assertRaises(ValueError): self.store.record(changed)
        self.assertEqual(len(list(self.store.export())), 1)

    def test_missing_and_inconsistent_turns_are_rejected(self):
        with self.assertRaises(ValueError): self.store.record(event(2))
        self.store.record(event())
        with self.assertRaises(ValueError): self.store.record(event(3))
        changed = event(2); changed['state_before'] = {'value': 90}
        with self.assertRaises(ValueError): self.store.record(changed)
        self.store.record(event(2))

    def test_durable_reload_and_no_automatic_reward(self):
        self.store.record(event())
        self.store.feedback('e1', kind='incorrect', source='human')
        self.store.feedback('e1', kind='correction_candidate', source='human', correction='客厅那个')
        self.store.close(); self.store = TrajectoryStore(self.path)
        row = list(self.store.export())[0]
        self.assertIsNone(row['reward']); self.assertFalse(row['training_eligible'])
        self.assertEqual(len(row['feedback']), 2)
        self.assertEqual(list(self.store.export(training_only=True)), [])

    def test_explicit_rewards_and_truncated_boundary(self):
        self.store.record(event()); self.store.record(event(2))
        self.store.feedback('e1', kind='rating', source='human', score=-1)
        self.assertEqual(list(self.store.export(training_only=True)), [])
        self.store.finish('session', reason='input_exhausted')
        rows = list(self.store.export())
        self.assertTrue(rows[0]['training_eligible']); self.assertFalse(rows[0]['truncated'])
        self.assertTrue(rows[1]['truncated']); self.assertFalse(rows[1]['terminated'])
        self.assertFalse(rows[0]['ppo_ready'])
        with self.assertRaises(ValueError): self.store.record(event(3))

    def test_only_explicit_human_numeric_score_is_initial_reward(self):
        self.store.record(event()); self.store.finish('session', terminated=True, reason='explicit_goal_end')
        self.store.feedback('e1', kind='rating', source='evaluator', score=1)
        self.assertIsNone(list(self.store.export())[0]['reward'])
        self.store.feedback('e1', kind='rating', source='human', score=-.5, feedback_id='f1')
        self.store.feedback('e1', kind='rating', source='human', score=-.5, feedback_id='f1')
        row = list(self.store.export())[0]
        self.assertTrue(row['terminated']); self.assertFalse(row['truncated']); self.assertEqual(row['reward'], -.5)
        with self.assertRaises(ValueError): self.store.feedback('e1', kind='rating', source='human', score=1, feedback_id='f1')

    def test_invalid_reward_or_candidate_cannot_silently_enter_training(self):
        self.store.record(event())
        for score in (float('nan'), float('inf'), 2, True):
            with self.assertRaises(ValueError): self.store.feedback('e1', kind='rating', source='human', score=score)
        with self.assertRaises(ValueError): self.store.feedback('e1', kind='correction_candidate', source='human', score=1)


if __name__ == '__main__': unittest.main()
