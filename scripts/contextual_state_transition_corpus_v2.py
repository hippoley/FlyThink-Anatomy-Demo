#!/usr/bin/env python3
"""V2 resolver-causal extension. V1 stays immutable/observed."""
from contextual_state_transition_corpus_v1 import build as build_v1, split_group as split_v1, target, row

V2_SPLIT = {
    "v2-train-focus-ac": "train",
    "v2-dev-focus-light": "dev",
    "v2-test-explicit-window": "test",
    "v2-train-set-lights": "train",
    "v2-dev-set-ac": "dev",
    "v2-test-set-windows": "test",
}

def _state():
    b = {k: dict(v) for k, v in build_v1()["examples"][0]["before_state"].items()}
    b.update({
        "书房::空调::default": {"power": "ON", "temperature": 24},
        "次卧::灯::default": {"power": "ON", "brightness": 50},
        "书房::窗户::default": {"power": "ON", "opening": 50},
    })
    return b

def build():
    base = build_v1()["examples"]
    b = _state()
    extra = [
        row("v2-train-focus-ac", "再低一点",
            {"focused_target": target("书房", "空调")},
            [("书房::空调::default", "temperature", 23)], before=b,
            semantic={"op": "PATCH_RELATIVE", "direction": "NEG", "slot": "temperature"}),
        row("v2-dev-focus-light", "再亮一点",
            {"focused_target": target("次卧", "灯")},
            [("次卧::灯::default", "brightness", 60)], before=b,
            semantic={"op": "PATCH_RELATIVE", "direction": "POS", "slot": "brightness"}),
        row("v2-test-explicit-window", "书房窗户开到30%",
            {"explicit_target": target("书房", "窗户")},
            [("书房::窗户::default", "opening", 30)], before=b,
            semantic={"op": "PATCH_SLOT", "slot": "opening", "has_value": True}),
    ]
    for group, areas, entity, slot, value in [
        ("v2-train-set-lights", ["客厅", "主卧"], "灯", "power", "OFF"),
        ("v2-dev-set-ac", ["客厅", "主卧"], "空调", "power", "ON"),
        ("v2-test-set-windows", ["客厅", "书房"], "窗户", "opening", 20),
    ]:
        before = _state()
        refs = [target(a, entity) for a in areas]
        delta = []
        for a in areas:
            key = f"{a}::{entity}::default"
            if before[key].get(slot) != value:
                delta.append((key, slot, value))
        extra.append(row(
            group, f"{'和'.join(areas)}的{entity}都设置",
            {"referent_set": refs}, delta, before=before,
            semantic={"op": "PATCH_SLOT", "cardinality": "SET", "slot": slot, "has_value": True},
        ))
    return {"truth": "contextual_state_transition_v2_resolver_causal", "examples": base + extra}

def split_group(group):
    if group in V2_SPLIT:
        return V2_SPLIT[group]
    return split_v1(group)
