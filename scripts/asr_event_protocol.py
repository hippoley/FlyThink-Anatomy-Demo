#!/usr/bin/env python3
"""Provider-neutral streaming ASR event protocol.

Recognizers may revise text many times. This adapter deliberately separates:
- partial: text changed and remains speculative
- stable: the same non-empty text survived N observations, but is still speculative
- final: recognizer endpoint or explicit input finalization

Only final is a commit boundary for the home runtime.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


EVENT_TYPE = "asr_hypothesis"
KINDS = {"partial", "stable", "final"}


def normalize_text(text: str | None) -> str:
    return " ".join(str(text or "").strip().split())


def validate_asr_event(event: dict[str, Any]) -> dict[str, Any]:
    if event.get("type") != EVENT_TYPE:
        raise ValueError("asr_event_type_required")
    if event.get("kind") not in KINDS:
        raise ValueError("asr_event_kind_invalid")
    if not normalize_text(event.get("text")):
        raise ValueError("asr_event_text_required")
    if not isinstance(event.get("segment_id"), int) or event["segment_id"] < 1:
        raise ValueError("asr_event_segment_id_invalid")
    if not isinstance(event.get("revision"), int) or event["revision"] < 1:
        raise ValueError("asr_event_revision_invalid")
    return event


@dataclass
class HypothesisEmitter:
    source: str = "unknown-asr"
    stable_repeats: int = 2

    def __post_init__(self) -> None:
        if self.stable_repeats < 2:
            raise ValueError("stable_repeats_must_be_at_least_2")
        self.segment_id = 1
        self.revision = 0
        self._last_text = ""
        self._same_count = 0
        self._stable_text: str | None = None

    def _event(
        self,
        kind: str,
        text: str,
        *,
        audio_ms: float | None,
        final_reason: str | None = None,
    ) -> dict[str, Any]:
        event: dict[str, Any] = {
            "type": EVENT_TYPE,
            "kind": kind,
            "text": text,
            "segment_id": self.segment_id,
            "revision": self.revision,
            "source": self.source,
        }
        if audio_ms is not None:
            event["audio_ms"] = round(float(audio_ms), 3)
        if final_reason is not None:
            event["final_reason"] = final_reason
        return validate_asr_event(event)

    def observe(
        self,
        text: str | None,
        *,
        audio_ms: float | None = None,
    ) -> list[dict[str, Any]]:
        text = normalize_text(text)
        if not text:
            return []

        if text != self._last_text:
            self.revision += 1
            self._last_text = text
            self._same_count = 1
            self._stable_text = None
            return [self._event("partial", text, audio_ms=audio_ms)]

        self._same_count += 1
        if self._same_count >= self.stable_repeats and self._stable_text != text:
            self._stable_text = text
            return [self._event("stable", text, audio_ms=audio_ms)]
        return []

    def finalize(
        self,
        text: str | None = None,
        *,
        audio_ms: float | None = None,
        reason: str = "endpoint",
    ) -> list[dict[str, Any]]:
        text = normalize_text(text) or self._last_text
        if not text:
            self._reset_segment()
            return []

        if text != self._last_text:
            self.revision += 1
            self._last_text = text
            self._same_count = 1
            self._stable_text = None

        out = [
            self._event(
                "final",
                text,
                audio_ms=audio_ms,
                final_reason=reason,
            )
        ]
        self._reset_segment()
        return out

    def _reset_segment(self) -> None:
        self.segment_id += 1
        self.revision = 0
        self._last_text = ""
        self._same_count = 0
        self._stable_text = None
