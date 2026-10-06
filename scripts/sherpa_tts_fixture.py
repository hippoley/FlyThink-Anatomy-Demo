#!/usr/bin/env python3
"""Generate a deterministic local Chinese speech fixture with sherpa-onnx TTS.

This exists only to create an acoustic acceptance input. The generated text is
never passed to SLU directly; downstream acceptance must consume the WAV
through the streaming ASR path.
"""
from __future__ import annotations

import argparse
import json
import wave
from pathlib import Path

import numpy as np


def load_sherpa():
    try:
        import sherpa_onnx
    except ImportError as exc:
        raise SystemExit(
            "sherpa-onnx is required; install requirements-asr.txt"
        ) from exc
    return sherpa_onnx


def write_pcm16_wav(path: Path, samples, sample_rate: int) -> None:
    data = np.asarray(samples, dtype=np.float32)
    if data.ndim != 1 or data.size == 0:
        raise RuntimeError("tts_generated_no_audio")
    if not np.isfinite(data).all():
        raise RuntimeError("tts_generated_non_finite_audio")
    pcm = np.clip(data, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm.tobytes())


def generate(args) -> dict:
    sherpa_onnx = load_sherpa()
    root = Path(args.model_dir)
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(root / args.model),
                lexicon=str(root / args.lexicon),
                tokens=str(root / args.tokens),
            ),
            num_threads=args.num_threads,
            provider=args.provider,
        ),
        rule_fsts=",".join(
            str(root / name)
            for name in args.rule_fst
            if (root / name).exists()
        ),
        max_num_sentences=1,
    )
    if not config.validate():
        raise RuntimeError("tts_config_invalid")

    tts = sherpa_onnx.OfflineTts(config)
    generation = sherpa_onnx.GenerationConfig()
    generation.sid = args.speaker_id
    generation.speed = args.speed
    generation.silence_scale = args.silence_scale
    audio = tts.generate(args.text, generation)

    sample_rate = int(getattr(audio, "sample_rate", 0) or 0)
    samples = getattr(audio, "samples", None)
    if sample_rate <= 0 or samples is None:
        raise RuntimeError("tts_generated_invalid_audio")

    out = Path(args.out)
    write_pcm16_wav(out, samples, sample_rate)
    duration_ms = len(samples) * 1000.0 / sample_rate
    result = {
        "truth": "local_tts_acoustic_fixture_v1",
        "text": args.text,
        "out": str(out),
        "sample_rate": sample_rate,
        "samples": len(samples),
        "duration_ms": round(duration_ms, 3),
        "speaker_id": args.speaker_id,
        "speed": args.speed,
    }
    print(json.dumps(result, ensure_ascii=False))
    return result


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--model-dir", required=True)
    p.add_argument("--text", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--model", default="zh_CN-xiao_ya-medium.onnx")
    p.add_argument("--lexicon", default="lexicon.txt")
    p.add_argument("--tokens", default="tokens.txt")
    p.add_argument(
        "--rule-fst",
        action="append",
        default=["phone.fst", "date.fst", "number.fst"],
    )
    p.add_argument("--speaker-id", type=int, default=0)
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--silence-scale", type=float, default=0.2)
    p.add_argument("--num-threads", type=int, default=1)
    p.add_argument("--provider", default="cpu")
    return p.parse_args()


if __name__ == "__main__":
    generate(parse_args())
