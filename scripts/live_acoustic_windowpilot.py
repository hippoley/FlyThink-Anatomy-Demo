#!/usr/bin/env python3
"""Compose the live acoustic -> SLU -> WindowPilot validation pipeline.

This wrapper only orchestrates processes. It does not duplicate or weaken the
commit/readiness/identity/closeout safety contract implemented by
run_acoustic_windowpilot_e2e.cjs.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def build_commands(args):
    root = Path(__file__).resolve().parents[1]
    asr = [
        sys.executable,
        str(root / "scripts" / "sherpa_streaming_asr.py"),
    ]
    if args.wav:
        asr += ["--wav", args.wav]
    else:
        asr += [
            "--pcm-stdin",
            "--input-sample-rate",
            str(args.input_sample_rate),
        ]
    asr += [
        "--chunk-ms",
        str(args.chunk_ms),
        "--stable-repeats",
        str(args.stable_repeats),
        "--tokens",
        args.tokens,
        "--model-sample-rate",
        str(args.model_sample_rate),
        "--num-threads",
        str(args.num_threads),
        "--provider",
        args.provider,
    ]
    if args.zipformer2_ctc_model:
        asr += ["--zipformer2-ctc-model", args.zipformer2_ctc_model]
    elif args.paraformer_encoder:
        asr += [
            "--paraformer-encoder",
            args.paraformer_encoder,
            "--paraformer-decoder",
            args.paraformer_decoder,
        ]
    else:
        asr += [
            "--encoder",
            args.encoder,
            "--decoder",
            args.decoder,
            "--joiner",
            args.joiner,
            "--decoding-method",
            args.decoding_method,
            "--max-active-paths",
            str(args.max_active_paths),
        ]

    node = [
        args.node,
        str(root / "scripts" / "run_acoustic_windowpilot_e2e.cjs"),
        "--url",
        args.url,
        "--target-json",
        json.dumps(
            {
                "area": args.area,
                "entity": args.entity,
                "instance": args.instance,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        "--probe-open-pct",
        str(args.probe_open_pct),
        "--tolerance",
        str(args.tolerance),
        "--timeout-ms",
        str(args.timeout_ms),
        "--graph",
        args.graph,
        "--judgement",
        args.judgement,
        "--semantic",
        args.semantic,
    ]
    if args.expected_hardware_identity:
        node += [
            "--expected-hardware-identity",
            args.expected_hardware_identity,
        ]
    if args.apply:
        node.append("--apply")
    return asr, node


def run(args) -> int:
    asr_cmd, node_cmd = build_commands(args)
    if args.print_commands:
        print(
            json.dumps(
                {
                    "asr": asr_cmd,
                    "windowpilot": node_cmd,
                    "mode": "APPLY" if args.apply else "DRY_RUN",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    node = subprocess.Popen(
        node_cmd,
        stdin=subprocess.PIPE,
    )
    try:
        asr_stdin = None if args.wav else sys.stdin.buffer
        asr = subprocess.Popen(
            asr_cmd,
            stdin=asr_stdin,
            stdout=node.stdin,
        )
        assert node.stdin is not None
        node.stdin.close()
        asr_code = asr.wait()
        if asr_code != 0:
            node.terminate()
            node.wait()
            raise SystemExit(asr_code)
        node_code = node.wait()
        return int(node_code)
    except KeyboardInterrupt:
        node.terminate()
        node.wait()
        raise


def parse_args():
    p = argparse.ArgumentParser()
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--wav")
    source.add_argument("--pcm-stdin", action="store_true")

    p.add_argument("--url", required=True)
    p.add_argument("--area", required=True)
    p.add_argument("--entity", default="窗")
    p.add_argument("--instance", default="default")
    p.add_argument("--expected-hardware-identity")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--probe-open-pct", type=float, default=5.0)
    p.add_argument("--tolerance", type=float, default=1.0)
    p.add_argument("--timeout-ms", type=int, default=5000)

    p.add_argument("--graph", required=True)
    p.add_argument("--judgement", required=True)
    p.add_argument("--semantic", required=True)

    p.add_argument("--tokens", required=True)
    p.add_argument("--encoder")
    p.add_argument("--decoder")
    p.add_argument("--joiner")
    p.add_argument("--zipformer2-ctc-model")
    p.add_argument("--paraformer-encoder")
    p.add_argument("--paraformer-decoder")
    p.add_argument("--input-sample-rate", type=int, default=16000)
    p.add_argument("--model-sample-rate", type=int, default=16000)
    p.add_argument("--chunk-ms", type=int, default=100)
    p.add_argument("--stable-repeats", type=int, default=2)
    p.add_argument("--num-threads", type=int, default=2)
    p.add_argument("--provider", default="cpu")
    p.add_argument(
        "--decoding-method",
        choices=("greedy_search", "modified_beam_search"),
        default="greedy_search",
    )
    p.add_argument("--max-active-paths", type=int, default=4)
    p.add_argument("--node", default="node")
    p.add_argument("--print-commands", action="store_true")

    args = p.parse_args()
    if not args.zipformer2_ctc_model and not args.paraformer_encoder:
        if not (args.encoder and args.decoder and args.joiner):
            p.error(
                "provide --zipformer2-ctc-model, "
                "--paraformer-encoder/--paraformer-decoder, "
                "or --encoder/--decoder/--joiner"
            )
    if args.paraformer_encoder and not args.paraformer_decoder:
        p.error("--paraformer-decoder is required")
    if args.apply and not args.expected_hardware_identity:
        p.error("--apply requires --expected-hardware-identity")
    return args


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
