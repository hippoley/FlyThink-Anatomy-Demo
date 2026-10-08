#!/usr/bin/env python3
import json
import math
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))

from acoustic_fixture_manifest import build_manifest
from live_acoustic_windowpilot import build_commands


def args(**overrides):
    base=dict(
        wav="command.wav",
        pcm_stdin=False,
        input_sample_rate=16000,
        chunk_ms=100,
        stable_repeats=2,
        tokens="asr/tokens.txt",
        model_sample_rate=16000,
        num_threads=2,
        provider="cpu",
        zipformer2_ctc_model=None,
        paraformer_encoder=None,
        paraformer_decoder=None,
        encoder="asr/encoder.onnx",
        decoder="asr/decoder.onnx",
        joiner="asr/joiner.onnx",
        decoding_method="greedy_search",
        max_active_paths=4,
        node="node",
        url="http://127.0.0.1:8001",
        area="主卧",
        entity="窗",
        instance="default",
        expected_hardware_identity=None,
        receipt=None,
        proof_bundle=None,
        contextual_state=None,
        authorization_ledger=None,
        spatialruntime_authorize=False,
        world_snapshot=None,
        world_validation_receipt=None,
        scene_context=None,
        fixture_manifest=None,
        require_human_fixture=False,
        apply=False,
        probe_open_pct=5.0,
        tolerance=1.0,
        timeout_ms=5000,
        graph="artifacts/flywire/connectome.json",
        judgement="artifacts/context-judgement-v3/model.pt",
        semantic="artifacts/semantic-patch-v1/model.pt",
        print_commands=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class LiveAcousticWindowPilotCliTest(unittest.TestCase):
    def test_dry_run_does_not_cross_apply_boundary(self):
        asr,node=build_commands(args())
        self.assertIn("--wav",asr)
        self.assertIn("command.wav",asr)
        self.assertNotIn("--apply",node)
        self.assertNotIn("--expected-hardware-identity",node)
        self.assertIn("--probe-open-pct",node)
        self.assertEqual(node[node.index("--probe-open-pct")+1],"5.0")

    def test_apply_preserves_identity_and_bounded_probe(self):
        _,node=build_commands(args(
            apply=True,
            expected_hardware_identity="hw-abc",
            receipt="live-receipt.json",
            proof_bundle="live-proof-bundle.json",
            contextual_state="contextual-state.json",
            authorization_ledger="authorization-ledger.json",
            spatialruntime_authorize=True,
            scene_context="scene-context.json",
            probe_open_pct=4.0,
        ))
        self.assertIn("--apply",node)
        self.assertEqual(
            node[node.index("--receipt")+1],
            "live-receipt.json",
        )
        self.assertEqual(
            node[node.index("--expected-hardware-identity")+1],
            "hw-abc",
        )
        self.assertEqual(node[node.index("--proof-bundle")+1],"live-proof-bundle.json")
        self.assertEqual(node[node.index("--contextual-state")+1],"contextual-state.json")
        self.assertEqual(node[node.index("--authorization-ledger")+1],"authorization-ledger.json")
        self.assertIn("--spatialruntime-authorize",node)
        self.assertEqual(node[node.index("--scene-context")+1],"scene-context.json")
        self.assertEqual(
            node[node.index("--probe-open-pct")+1],
            "4.0",
        )
        target=node[node.index("--target-json")+1]
        self.assertIn("主卧",target)
        self.assertIn("窗",target)

    def test_pcm_mode_wires_stdin_source(self):
        asr,_=build_commands(args(wav=None,pcm_stdin=True))
        self.assertIn("--pcm-stdin",asr)
        self.assertNotIn("--wav",asr)
        self.assertEqual(
            asr[asr.index("--input-sample-rate")+1],
            "16000",
        )

    def test_human_fixture_manifest_is_verified_and_forwarded(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            wav_path=root/"human.wav"
            manifest_path=root/"human.json"
            sample_rate=16000
            frames=4000
            with wave.open(str(wav_path),"wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sample_rate)
                data=bytearray()
                for i in range(frames):
                    sample=int(10000*math.sin(2*math.pi*440*i/sample_rate))
                    data.extend(struct.pack("<h",sample))
                wf.writeframes(bytes(data))
            manifest=build_manifest(
                wav_path,
                "human_recording",
                "打开主卧窗",
                "reviewed microphone recording",
            )
            manifest_path.write_text(
                json.dumps(manifest,ensure_ascii=False),
                encoding="utf-8",
            )
            _,node=build_commands(args(
                wav=str(wav_path),
                fixture_manifest=str(manifest_path),
                require_human_fixture=True,
                receipt="receipt.json",
                proof_bundle="proof-bundle.json",
                contextual_state="contextual-state.json",
                authorization_ledger="authorization-ledger.json",
                spatialruntime_authorize=True,
                scene_context="scene-context.json",
                apply=True,
                expected_hardware_identity="hw-abc",
            ))
            payload=json.loads(
                node[node.index("--acoustic-fixture-json")+1]
            )
            self.assertEqual(payload["source_kind"],"human_recording")
            self.assertEqual(payload["expected_text"],"打开主卧窗")
            self.assertEqual(payload["max_cer"],0.25)
            self.assertTrue(payload["require_human_acceptance"])
            self.assertEqual(payload["wav_sha256"],manifest["wav"]["sha256"])
            self.assertEqual(len(payload["manifest_sha256"]),64)

    def test_apply_builder_rejects_missing_canonical_inputs(self):
        base=dict(
            apply=True,
            expected_hardware_identity="hw-abc",
            receipt="receipt.json",
            proof_bundle="proof.json",
            contextual_state="context.json",
            authorization_ledger="ledger.json",
            spatialruntime_authorize=True,
            scene_context="scene.json",
        )
        for key,pattern in [
            ("proof_bundle","--proof-bundle"),
            ("contextual_state","--contextual-state"),
            ("authorization_ledger","--authorization-ledger"),
            ("spatialruntime_authorize","--spatialruntime-authorize"),
            ("scene_context","SpatialRuntime scene identity"),
        ]:
            case=dict(base)
            case[key]=False if key=="spatialruntime_authorize" else None
            with self.assertRaisesRegex(SystemExit,pattern):
                build_commands(args(**case))

    def test_apply_builder_rejects_missing_receipt(self):
        with self.assertRaisesRegex(SystemExit,"--apply requires --receipt"):
            build_commands(args(
                apply=True,
                expected_hardware_identity="hw-abc",
                receipt=None,
            ))

    def test_apply_builder_rejects_missing_identity(self):
        with self.assertRaisesRegex(SystemExit,"hardware-identity"):
            build_commands(args(
                apply=True,
                expected_hardware_identity=None,
                receipt="receipt.json",
            ))

    def test_tts_manifest_cannot_claim_human_acceptance(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            wav_path=root/"tts.wav"
            manifest_path=root/"tts.json"
            with wave.open(str(wav_path),"wb") as wf:
                wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(16000)
                wf.writeframes(b"\x00\x00"*1600)
            manifest=build_manifest(
                wav_path,"local_tts","打开主卧窗","deterministic TTS"
            )
            manifest_path.write_text(json.dumps(manifest),encoding="utf-8")
            with self.assertRaisesRegex(SystemExit,"source kind"):
                build_commands(args(
                    wav=str(wav_path),
                    fixture_manifest=str(manifest_path),
                    require_human_fixture=True,
                ))

if __name__=="__main__":
    unittest.main()
