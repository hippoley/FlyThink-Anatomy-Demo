import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from dialogue_delta_corpus import corpus, NONE
from accuracy_gate import assess, REQUIRED


class SupervisionContract(unittest.TestCase):
    def test_implicit_references_always_have_an_observable_target(self):
        switches = 0
        for split in ('train', 'test'):
            for dialogue in corpus()[split]:
                for turn in dialogue['turns']:
                    before, d = turn['before'], turn['delta']
                    if d['reference'] != 'focus_coreference':
                        continue
                    focus = before['focus']
                    self.assertLess(focus, NONE, turn)
                    self.assertNotEqual(before['values'][focus], 0, turn)
                    self.assertEqual(d['targets'][0] // 2, focus // 2, turn)
                    if d['op'] == 'resume':
                        self.assertTrue(before['paused'][focus], turn)
                    if d['op'] == 'pause':
                        self.assertFalse(before['paused'][focus], turn)
                    switches += d['op'] == 'revise' and d['targets'][0] % 2 != focus % 2
        self.assertGreater(switches, 100)

    def test_gate_requires_every_metric(self):
        good = dict.fromkeys(REQUIRED, .91)
        self.assertTrue(assess(good)['passed'])
        for value in (None, float('nan'), .899, True, 1.01):
            with self.subTest(value=value):
                self.assertFalse(assess({**good, 'retraction_delta_exact': value})['passed'])
        del good['ood_route_accuracy']
        self.assertFalse(assess(good)['passed'])


if __name__ == '__main__':
    unittest.main()
