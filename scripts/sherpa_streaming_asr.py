#!/usr/bin/env python3
"""Emit provider-neutral streaming ASR JSONL from WAV or raw PCM.

This module is an acoustic source only. It never authorizes home execution.
Stable hypotheses remain speculative; endpoint or EOF produces final.
"""
from __future__ import annotations

import argparse
import json
import sys
import wave
from pathlib import Path
from typing import Iterable

import numpy as np

from asr_event_protocol import HypothesisEmitter


def load_sherpa():
    try:
        import sherpa_onnx
    except ImportError as exc:
        raise SystemExit(
            "sherpa-onnx is required; install requirements-asr.txt"
        ) from exc
    return sherpa_onnx


def result_text(recognizer, stream) -> str:
    result = recognizer.get_result(stream)
    if isinstance(result, str):
        return result.strip()
    return str(getattr(result, "text", "") or "").strip()


def create_recognizer(args):
    sherpa_onnx = load_sherpa()
    common = dict(
        tokens=args.tokens,
        num_threads=args.num_threads,
        sample_rate=args.model_sample_rate,
        feature_dim=80,
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=args.rule1_silence,
        rule2_min_trailing_silence=args.rule2_silence,
        rule3_min_utterance_length=args.rule3_length,
        provider=args.provider,
    )
    if args.zipformer2_ctc_model:
        return sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc(
            model=args.zipformer2_ctc_model,
            decoding_method="greedy_search",
            **common,
        )
    if args.paraformer_encoder:
        if not args.paraformer_decoder:
            raise SystemExit("--paraformer-decoder is required")
        return sherpa_onnx.OnlineRecognizer.from_paraformer(
            encoder=args.paraformer_encoder,
            decoder=args.paraformer_decoder,
            decoding_method="greedy_search",
            **common,
        )
    if not (args.encoder and args.decoder and args.joiner):
        raise SystemExit(
            "provide either --zipformer2-ctc-model, "
            "--paraformer-encoder/--paraformer-decoder, "
            "or --encoder/--decoder/--joiner"
        )
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        encoder=args.encoder,
        decoder=args.decoder,
        joiner=args.joiner,
        decoding_method=args.decoding_method,
        max_active_paths=args.max_active_paths,
        hotwords_file=args.hotwords_file,
        hotwords_score=args.hotwords_score,
        modeling_unit=args.modeling_unit,
        bpe_vocab=args.bpe_vocab,
        **common,
    )


def read_wav_chunks(path: Path, chunk_ms: int) -> Iterable[tuple[int, np.ndarray]]:
    with wave.open(str(path), "rb") as wf:
        if wf.getnchannels() != 1:
            raise SystemExit("WAV must be mono")
        if wf.getsampwidth() != 2:
            raise SystemExit("WAV must be 16-bit PCM")
        sample_rate = wf.getframerate()
        frames_per_chunk = max(1, int(sample_rate * chunk_ms / 1000))
        while True:
            raw = wf.readframes(frames_per_chunk)
            if not raw:
                break
            samples = np.frombuffer(raw, dtype=np.int16)
            samples = samples.astype(np.float32) / 32768.0
            yield sample_rate, samples


def read_pcm_stdin_chunks(sample_rate: int, chunk_ms: int):
    frames = max(1, int(sample_rate * chunk_ms / 1000))
    bytes_per_chunk = frames * 2
    while True:
        raw = sys.stdin.buffer.read(bytes_per_chunk)
        if not raw:
            break
        samples = np.frombuffer(raw, dtype=np.int16)
        samples = samples.astype(np.float32) / 32768.0
        yield sample_rate, samples


def emit(event: dict) -> None:
    sys.stdout.write(
        json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    sys.stdout.flush()


def decode(args) -> int:
    recognizer = create_recognizer(args)
    emitter = HypothesisEmitter(
        source="sherpa-onnx",
        stable_repeats=args.stable_repeats,
    )
    stream = recognizer.create_stream()
    total_samples = 0
    current_sample_rate = None
    last_text = ""

    chunks = (
        read_wav_chunks(Path(args.wav), args.chunk_ms)
        if args.wav
        else read_pcm_stdin_chunks(args.input_sample_rate, args.chunk_ms)
    )

    for sample_rate, samples in chunks:
        current_sample_rate = sample_rate
        total_samples += len(samples)
        stream.accept_waveform(sample_rate, samples)

        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)

        text = result_text(recognizer, stream)
        last_text = text or last_text
        audio_ms = total_samples * 1000.0 / sample_rate
        for event in emitter.observe(text, audio_ms=audio_ms):
            emit(event)

        if recognizer.is_endpoint(stream):
            for event in emitter.finalize(
                text,
                audio_ms=audio_ms,
                reason="endpoint",
            ):
                emit(event)
            recognizer.reset(stream)
            last_text = ""

    if current_sample_rate is None:
        raise SystemExit("no audio samples received")

    tail = np.zeros(int(0.5 * current_sample_rate), dtype=np.float32)
    stream.accept_waveform(current_sample_rate, tail)
    stream.input_finished()
    while recognizer.is_ready(stream):
        recognizer.decode_stream(stream)

    text = result_text(recognizer, stream) or last_text
    audio_ms = total_samples * 1000.0 / current_sample_rate
    for event in emitter.observe(text, audio_ms=audio_ms):
        emit(event)
    for event in emitter.finalize(text, audio_ms=audio_ms, reason="eof"):
        emit(event)
    return 0


def parse_args():
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--wav")
    source.add_argument("--pcm-stdin", action="store_true")
    parser.add_argument("--input-sample-rate", type=int, default=16000)
    parser.add_argument("--chunk-ms", type=int, default=100)
    parser.add_argument("--stable-repeats", type=int, default=2)

    parser.add_argument("--tokens", required=True)
    parser.add_argument("--encoder")
    parser.add_argument("--decoder")
    parser.add_argument("--joiner")
    parser.add_argument("--zipformer2-ctc-model")
    parser.add_argument("--paraformer-encoder")
    parser.add_argument("--paraformer-decoder")
    parser.add_argument("--model-sample-rate", type=int, default=16000)
    parser.add_argument("--num-threads", type=int, default=2)
    parser.add_argument("--provider", default="cpu")
    parser.add_argument(
        "--decoding-method",
        choices=("greedy_search", "modified_beam_search"),
        default="greedy_search",
    )
    parser.add_argument("--max-active-paths", type=int, default=4)
    parser.add_argument("--hotwords-file", default="")
    parser.add_argument("--hotwords-score", type=float, default=1.5)
    parser.add_argument(
        "--modeling-unit",
        choices=("cjkchar", "bpe", "cjkchar+bpe"),
        default="cjkchar",
    )
    parser.add_argument("--bpe-vocab", default="")
    parser.add_argument("--rule1-silence", type=float, default=2.4)
    parser.add_argument("--rule2-silence", type=float, default=1.2)
    parser.add_argument("--rule3-length", type=float, default=20.0)
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(decode(parse_args()))
