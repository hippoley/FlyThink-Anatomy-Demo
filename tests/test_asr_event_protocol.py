#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from asr_event_protocol import HypothesisEmitter, validate_asr_event


class AsrEventProtocolTest(unittest.TestCase):
    def test_revision_stability_and_final_boundary(self):
        emitter = HypothesisEmitter(source="test", stable_repeats=2)

        first = emitter.observe("把客厅", audio_ms=100)
        self.assertEqual([(x["kind"], x["revision"]) for x in first], [("partial", 1)])

        stable = emitter.observe("把客厅", audio_ms=200)
        self.assertEqual([(x["kind"], x["revision"]) for x in stable], [("stable", 1)])
        self.assertEqual(emitter.observe("把客厅", audio_ms=300), [])

        revised = emitter.observe("把主卧空调调到24度", audio_ms=400)
        self.assertEqual(revised[0]["kind"], "partial")
        self.assertEqual(revised[0]["revision"], 2)

        final = emitter.finalize(audio_ms=500, reason="endpoint")
        self.assertEqual(final[0]["kind"], "final")
        self.assertEqual(final[0]["revision"], 2)
        self.assertEqual(final[0]["segment_id"], 1)

        next_segment = emitter.observe("打开窗户", audio_ms=100)
        self.assertEqual(next_segment[0]["segment_id"], 2)
        self.assertEqual(next_segment[0]["revision"], 1)

    def test_final_revision_can_include_last_second_correction(self):
        emitter = HypothesisEmitter(source="test")
        emitter.observe("客厅空调26度")
        final = emitter.finalize("主卧空调24度", reason="endpoint")
        self.assertEqual(final[0]["kind"], "final")
        self.assertEqual(final[0]["revision"], 2)
        self.assertEqual(final[0]["text"], "主卧空调24度")

    def test_schema_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "kind"):
            validate_asr_event(
                {
                    "type": "asr_hypothesis",
                    "kind": "committed",
                    "text": "开窗",
                    "segment_id": 1,
                    "revision": 1,
                }
            )


if __name__ == "__main__":
    unittest.main()
