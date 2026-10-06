#!/usr/bin/env python3
"""Generate reproducible synthetic spoken-home-command WAV fixtures.

This is explicitly synthetic acoustic evidence. It is used to exercise the
complete audio -> ASR -> SLU -> physical-runtime chain before human recordings
are frozen.
"""
from __future__ import annotations

import argparse
import wave

import numpy as np
import sherpa_onnx


def build_tts(args):
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=args.model,
                lexicon=args.lexicon,
                tokens=args.tokens,
            ),
            provider=args.provider,
            num_threads=args.num_threads,
        ),
        rule_fsts=args.rule_fsts,
        max_num_sentences=1,
    )
    if not config.validate():
        raise SystemExit("invalid sherpa-onnx TTS configuration")
    return sherpa_onnx.OfflineTts(config)


def write_pcm16(path: str, samples, sample_rate: int) -> None:
    data = np.asarray(samples, dtype=np.float32)
    data = np.clip(data, -1.0, 1.0)
    pcm = (data * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm.tobytes())


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--lexicon", required=True)
    p.add_argument("--tokens", required=True)
    p.add_argument("--rule-fsts", default="")
    p.add_argument("--sid", type=int, default=0)
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--provider", default="cpu")
    p.add_argument("--num-threads", type=int, default=2)
    p.add_argument("--output", required=True)
    p.add_argument("text")
    args = p.parse_args()

    tts = build_tts(args)
    gen = sherpa_onnx.GenerationConfig()
    gen.sid = args.sid
    gen.speed = args.speed
    gen.silence_scale = 0.2
    audio = tts.generate(args.text, gen)
    if len(audio.samples) == 0:
        raise SystemExit("TTS returned no samples")
    write_pcm16(args.output, audio.samples, audio.sample_rate)
    print(
        {
            "output": args.output,
            "sample_rate": int(audio.sample_rate),
            "samples": len(audio.samples),
            "sid": args.sid,
            "speed": args.speed,
            "text": args.text,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
