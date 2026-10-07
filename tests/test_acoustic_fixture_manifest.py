#!/usr/bin/env python3
import json
import math
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))

from acoustic_fixture_manifest import build_manifest,verify_manifest


def write_wav(path: Path, hz=440, sample_rate=16000, seconds=0.25):
    frames=int(sample_rate*seconds)
    with wave.open(str(path),"wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        data=bytearray()
        for i in range(frames):
            sample=int(12000*math.sin(2*math.pi*hz*i/sample_rate))
            data.extend(struct.pack("<h",sample))
        wf.writeframes(bytes(data))


class AcousticFixtureManifestTest(unittest.TestCase):
    def test_human_fixture_freezes_exact_wav(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            wav=root/"human.wav"
            write_wav(wav)
            manifest=build_manifest(
                wav,
                "human_recording",
                "打开主卧空调",
                "reviewed local microphone recording",
            )
            report=verify_manifest(wav,manifest,"human_recording")
            self.assertTrue(report["valid"],report["reasons"])
            self.assertEqual(report["source_kind"],"human_recording")

    def test_replacing_wav_bytes_fails(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            wav=root/"fixture.wav"
            write_wav(wav,hz=440)
            manifest=build_manifest(
                wav,"human_recording","打开主卧空调","reviewed mic"
            )
            write_wav(wav,hz=660)
            report=verify_manifest(wav,manifest,"human_recording")
            self.assertFalse(report["valid"])
            self.assertTrue(any("SHA256 mismatch" in x for x in report["reasons"]))

    def test_tts_fixture_cannot_satisfy_human_acceptance(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            wav=root/"tts.wav"
            write_wav(wav)
            manifest=build_manifest(
                wav,"local_tts","打开主卧空调","local deterministic TTS"
            )
            report=verify_manifest(wav,manifest,"human_recording")
            self.assertFalse(report["valid"])
            self.assertTrue(any("source kind" in x for x in report["reasons"]))

    def test_human_manifest_requires_provenance_note(self):
        with tempfile.TemporaryDirectory() as d:
            wav=Path(d)/"human.wav"
            write_wav(wav)
            with self.assertRaisesRegex(ValueError,"provenance"):
                build_manifest(wav,"human_recording","打开主卧空调","")


if __name__=="__main__":
    unittest.main()
