#!/usr/bin/env python3
"""Freeze and verify acoustic acceptance fixtures.

This does not infer whether a voice is human. It makes the claimed provenance
and exact WAV bytes explicit so a reviewed human recording cannot silently be
replaced by TTS or by another file later.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import wave
from pathlib import Path

SCHEMA="flythink.acoustic_fixture.v1"
SOURCE_KINDS={"human_recording","local_tts","official_fixture"}


def sha256_file(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()


def inspect_wav(path: Path) -> dict:
    with wave.open(str(path),"rb") as wf:
        channels=wf.getnchannels()
        sample_width=wf.getsampwidth()
        sample_rate=wf.getframerate()
        frames=wf.getnframes()
        compression=wf.getcomptype()
    if compression!="NONE":
        raise ValueError("acoustic_fixture_wav_must_be_pcm")
    if channels!=1:
        raise ValueError("acoustic_fixture_wav_must_be_mono")
    if sample_width!=2:
        raise ValueError("acoustic_fixture_wav_must_be_pcm16")
    if sample_rate<=0 or frames<=0:
        raise ValueError("acoustic_fixture_wav_empty")
    return {
        "channels":channels,
        "sample_width_bytes":sample_width,
        "sample_rate":sample_rate,
        "frames":frames,
        "duration_ms":round(frames*1000.0/sample_rate,3),
    }


def build_manifest(path: Path,source_kind: str,expected_text: str,provenance_note: str) -> dict:
    if source_kind not in SOURCE_KINDS:
        raise ValueError("acoustic_fixture_source_kind_invalid")
    if not expected_text.strip():
        raise ValueError("acoustic_fixture_expected_text_required")
    if source_kind=="human_recording" and not provenance_note.strip():
        raise ValueError("human_recording_requires_provenance_note")
    info=inspect_wav(path)
    return {
        "schema":SCHEMA,
        "source_kind":source_kind,
        "expected_text":expected_text.strip(),
        "provenance_note":provenance_note.strip() or None,
        "wav":{
            "sha256":sha256_file(path),
            "bytes":path.stat().st_size,
            **info,
        },
    }


def verify_manifest(path: Path,manifest: dict,required_source_kind: str|None=None) -> dict:
    reasons=[]
    if manifest.get("schema")!=SCHEMA:
        reasons.append("acoustic fixture schema mismatch")
    source_kind=manifest.get("source_kind")
    if source_kind not in SOURCE_KINDS:
        reasons.append("acoustic fixture source kind invalid")
    if required_source_kind and source_kind!=required_source_kind:
        reasons.append(
            f"acoustic fixture source kind {source_kind!r} != required {required_source_kind!r}"
        )
    if source_kind=="human_recording" and not str(manifest.get("provenance_note") or "").strip():
        reasons.append("human acoustic fixture missing provenance note")
    if not str(manifest.get("expected_text") or "").strip():
        reasons.append("acoustic fixture expected text missing")

    try:
        actual=inspect_wav(path)
        actual_sha=sha256_file(path)
        declared=manifest.get("wav") or {}
        if declared.get("sha256")!=actual_sha:
            reasons.append("acoustic fixture WAV SHA256 mismatch")
        if int(declared.get("bytes",-1))!=path.stat().st_size:
            reasons.append("acoustic fixture WAV byte length mismatch")
        for field in ("channels","sample_width_bytes","sample_rate","frames"):
            if int(declared.get(field,-1))!=int(actual[field]):
                reasons.append(f"acoustic fixture WAV {field} mismatch")
        if abs(float(declared.get("duration_ms",-1))-float(actual["duration_ms"]))>0.001:
            reasons.append("acoustic fixture WAV duration mismatch")
    except Exception as exc:
        reasons.append(f"cannot inspect acoustic fixture WAV: {exc}")

    return {
        "valid":not reasons,
        "reasons":reasons,
        "schema":manifest.get("schema"),
        "source_kind":source_kind,
        "expected_text":manifest.get("expected_text"),
        "wav_sha256":sha256_file(path) if path.exists() else None,
    }


def main():
    p=argparse.ArgumentParser()
    sub=p.add_subparsers(dest="command",required=True)

    create=sub.add_parser("create")
    create.add_argument("--wav",required=True)
    create.add_argument("--source-kind",required=True,choices=sorted(SOURCE_KINDS))
    create.add_argument("--expected-text",required=True)
    create.add_argument("--provenance-note",default="")
    create.add_argument("--out",required=True)

    verify=sub.add_parser("verify")
    verify.add_argument("--wav",required=True)
    verify.add_argument("--manifest",required=True)
    verify.add_argument("--require-source-kind",choices=sorted(SOURCE_KINDS))

    args=p.parse_args()
    wav=Path(args.wav)
    if args.command=="create":
        manifest=build_manifest(
            wav,args.source_kind,args.expected_text,args.provenance_note
        )
        Path(args.out).write_text(
            json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",
            encoding="utf-8",
        )
        print(json.dumps(manifest,ensure_ascii=False))
        return 0

    manifest=json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    report=verify_manifest(wav,manifest,args.require_source_kind)
    print(json.dumps(report,ensure_ascii=False))
    return 0 if report["valid"] else 2


if __name__=="__main__":
    raise SystemExit(main())
