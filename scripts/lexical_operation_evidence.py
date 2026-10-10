#!/usr/bin/env python3
"""High-precision lexical operation evidence.

These rules are deliberately narrow. They may repair a neural operation label
only when surface wording uniquely identifies a state mutation. Safety policy
still lives outside this evidence layer.
"""
import re

OPEN=("打开","开启","开起来","再打开","重新开启","启动")
CLOSE=("关掉","关闭","关上","停掉")
PROTECT=("保持","不要改","别改","维持")

_SET_PATTERNS=(
    re.compile(r"(?:温度|目标温度)[^\d]{0,8}\d{1,2}\s*度"),
    re.compile(r"(?:亮度|调光)[^\d]{0,8}\d{1,3}\s*%"),
    re.compile(r"(?:窗户?|开度|开窗)[^\d]{0,8}(?:开到|调到|设到|设置为)?[^\d]{0,4}\d{1,3}\s*%"),
    re.compile(r"(?:开到|开度调到|开度设为)\s*\d{1,3}\s*%"),
)

_REL_NEG=("再低一点","再低点","低一点","调低一点","再暗一点","暗一点","开小一点","再开小一点","少开一点")
_REL_POS=("再高一点","再高点","高一点","调高一点","再亮一点","亮一点","开大一点","再开大一点","多开一点","继续开一点")

LIFECYCLE_CUES=(
    "撤销","撤回","还原","恢复执行前","取消","作废","不要了","算了","undo",
    "上一条","上一个已","刚才那个不要","待处理那条","待执行","排队的",
)


def operation_evidence(text,context=None):
    t=text or ""
    if any(x in t for x in PROTECT):
        return None

    # Explicit set-value language is stronger evidence than a generic open verb.
    if any(p.search(t) for p in _SET_PATTERNS):
        return {"op":"PATCH_SLOT","source":"lexical_set_value","confidence":1.0}

    neg=any(x in t for x in _REL_NEG)
    pos=any(x in t for x in _REL_POS)
    if neg and not pos:
        return {"op":"PATCH_RELATIVE","direction":"NEG","source":"lexical_relative","confidence":1.0}
    if pos and not neg:
        return {"op":"PATCH_RELATIVE","direction":"POS","source":"lexical_relative","confidence":1.0}

    close=any(x in t for x in CLOSE)
    open_=any(x in t for x in OPEN)
    if close and not open_:
        return {"op":"CLOSE_DEVICE","source":"lexical_actuator","confidence":1.0}
    if open_ and not close:
        # Preserve legacy/no-context behavior for callers that are explicitly
        # reasoning about Add-target. In the online runtime, a bound existing
        # target is a power-state mutation, not persistent target creation.
        ctx=context or {}
        if context is not None and not ctx.get("add_target") and (
            ctx.get("focused_target") or ctx.get("referent_set")
        ):
            return {
                "op":"PATCH_SLOT","slot":"power","value":"ON",
                "source":"lexical_existing_device_power_on","confidence":1.0
            }
        return {"op":"ADD_DEVICE","source":"lexical_actuator","confidence":1.0}
    return None


def has_lifecycle_cue(text):
    t=(text or "").lower()
    return any(cue.lower() in t for cue in LIFECYCLE_CUES)


def _safety_context_clear(context,background):
    bg=background or {}
    ctx=context or {}
    if bg.get("rain") is True or bg.get("rain_detected") is True:
        return False
    protected=(
        list(bg.get("protected") or [])
        + list(bg.get("protected_paths") or [])
        + list(ctx.get("protected_paths") or [])
    )
    return not protected


def safe_block_override(evidence, context, background):
    """Only semantic-relative BLOCKs may be repaired, never explicit safety blocks."""
    if not evidence or evidence.get("op")!="PATCH_RELATIVE":
        return False
    if not _safety_context_clear(context,background):
        return False
    ctx=context or {}
    # A resolved referent is required; never turn ambiguity into actuation.
    return bool(ctx.get("focused_target") or ctx.get("add_target") or ctx.get("referent_set"))


def safe_lifecycle_override(evidence,text,context,background):
    """Prevent stale execution history from hijacking a clear current action.

    We only override CANCEL/UNDO when the utterance itself contains a high-
    precision actuator/value/relative action, has a resolved target, carries no
    lifecycle cue, and has no explicit safety/protection conflict.
    """
    if not evidence or evidence.get("op") not in {
        "ADD_DEVICE","CLOSE_DEVICE","PATCH_SLOT","PATCH_RELATIVE"
    }:
        return False
    if has_lifecycle_cue(text):
        return False
    if not _safety_context_clear(context,background):
        return False
    ctx=context or {}
    return bool(ctx.get("focused_target") or ctx.get("add_target") or ctx.get("referent_set"))
